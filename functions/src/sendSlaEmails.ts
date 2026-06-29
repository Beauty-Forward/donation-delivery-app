import { sendEmailOnce } from './givebutter-webhook.js';
import { onSchedule } from 'firebase-functions/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { ResendEmailService } from './services/resend.service';
import { DonorInfo } from './models';

const db = getFirestore();

const resendEmailService = new ResendEmailService();

// Honors the confirmation page's "we'll email you within 24 hours" promise for
// pickups that land in dispatch_failed: the Givebutter webhook verified payment but
// the Roadie booking threw, so the courier isn't booked yet. We reassure the donor
// (payment went through, we're sorting out the courier) and the warn log flags it
// for ops to rebook by hand.
//
// Runs hourly and emails each stalled pickup exactly once (slaEmailSentAt flag).
// Because it queries live state, a doc ops later rescues (rebooked ->
// queued_for_dispatch) no longer matches, so we never send a redundant note.
// Firestore can't filter on a missing field, so we query by status and filter
// slaEmailSentAt / recency in memory — the dispatch_failed set is tiny.
//
// Recency guard: only email pickups created within RECENCY_WINDOW_MS. This keeps a
// fresh deploy (or a backlog) from blasting ancient stuck docs that are past SLA and
// belong to manual ops cleanup; those are logged instead. A pickup currently inside
// its 24h SLA falls inside the window, so the first run after deploy emails it.
const SLA_RECENCY_WINDOW_MS = 48 * 60 * 60 * 1000;

export const sendStalledDonationSlaEmails = onSchedule(
  { region: 'us-central1', schedule: 'every 1 hours', timeZone: 'America/New_York' },
  async () => {
    const cutoff = Timestamp.fromMillis(Date.now() - SLA_RECENCY_WINDOW_MS);

    const snapshot = await db
      .collection('donation_requests')
      .where('status', '==', 'dispatch_failed')
      .get();

    let sent = 0;
    let stale = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();

      if (data['donationType'] !== 'pickup') {
        continue;
      }
      if (data['slaEmailSentAt']) {
        continue;
      }

      const createdAt = data['createdAt'] as Timestamp | undefined;
      if (!createdAt || createdAt.toMillis() < cutoff.toMillis()) {
        // Past the SLA window — don't auto-email a donor about a days-old stall.
        stale += 1;
        console.warn('[sla] stalled pickup past recency window; needs manual ops review', {
          requestId: doc.id,
          createdAt: createdAt?.toDate?.()?.toISOString?.() ?? null,
        });
        continue;
      }

      const donor = data['donor'] as DonorInfo | undefined;
      if (!donor?.email) {
        console.warn('[sla] stalled pickup missing donor email; skipping', { requestId: doc.id });
        continue;
      }

      // dispatch_failed always means payment was verified (the webhook stashed the
      // amount in metadata) — only the courier booking failed. Reassure with the
      // verified amount.
      const verifiedAmountUsd =
        typeof data['metadata']?.['verifiedAmountUsd'] === 'number'
          ? (data['metadata']['verifiedAmountUsd'] as number)
          : undefined;

      await sendEmailOnce(doc.id, 'slaEmailSentAt', () =>
        resendEmailService.sendStalledPickupEmail({
          donor,
          requestId: doc.id,
          verifiedAmountUsd,
        }),
      );
      sent += 1;
    }

    console.info('[sla] stalled-donation sweep complete', {
      scanned: snapshot.size,
      emailed: sent,
      pastWindow: stale,
    });
  },
);

// Recovers abandoned pickups. A donor created the request (doc lands in
// verifying_payment) but never completed payment in the Givebutter widget, so the
// webhook never fired and the doc sits in verifying_payment indefinitely. This is the
// orphaned-payment gap — there's no other signal that they dropped off. We send a
// single "complete your donation" nudge (recoveryEmailSentAt flag). A donor who later
// pays (-> webhook -> queued_for_dispatch) no longer matches the status query, so
// they're never nudged after the fact.
//
// Two age gates bound the sweep. MIN_AGE: only docs stalled past 24h qualify, so we
// never nudge someone who's simply mid-checkout. RECENCY_CAP: a fresh deploy (or a
// backlog) must not blast ancient abandoned docs well past any reasonable recovery
// window; those are logged for manual ops review. Firestore can't filter on a missing
// field, so we query by status and filter recoveryEmailSentAt / age in memory.

const RECOVERY_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const RECOVERY_RECENCY_CAP_MS = 7 * 24 * 60 * 60 * 1000;

export const sendStalledRecoveryEmails = onSchedule(
  { region: 'us-central1', schedule: 'every day 09:00', timeZone: 'America/New_York' },
  async () => {
    const now = Date.now();
    const minAgeCutoff = now - RECOVERY_MIN_AGE_MS;
    const recencyCutoff = now - RECOVERY_RECENCY_CAP_MS;

    const snapshot = await db
      .collection('donation_requests')
      .where('status', '==', 'verifying_payment')
      .get();

    let sent = 0;
    let tooFresh = 0;
    let stale = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();

      // verifying_payment only ever lands on pickups (shipping/dropoff skip the
      // payment gate), and the recovery copy is pickup-specific. Guard anyway.
      if (data['donationType'] !== 'pickup') {
        continue;
      }
      if (data['recoveryEmailSentAt']) {
        continue;
      }

      const createdAt = data['createdAt'] as Timestamp | undefined;
      if (!createdAt) {
        console.warn('[recovery] abandoned pickup missing createdAt; skipping', {
          requestId: doc.id,
        });
        continue;
      }
      if (createdAt.toMillis() > minAgeCutoff) {
        // Younger than 24h — the immediate recovery send (or a late webhook) may
        // still resolve it. A later run picks it up once it crosses the threshold.
        tooFresh += 1;
        continue;
      }
      if (createdAt.toMillis() < recencyCutoff) {
        // Past the recency cap — don't auto-nudge a donor about a week-old failure.
        stale += 1;
        console.warn(
          '[recovery] abandoned pickup past recency cap; needs manual ops review',
          {
            requestId: doc.id,
            createdAt: createdAt.toDate().toISOString(),
          },
        );
        continue;
      }

      const donor = data['donor'] as DonorInfo | undefined;
      if (!donor?.email) {
        // e.g. failureReason 'missing_donor_email' — nothing to send to.
        console.warn('[recovery] abandoned pickup missing donor email; skipping', {
          requestId: doc.id,
        });
        continue;
      }

      await sendEmailOnce(doc.id, 'recoveryEmailSentAt', () =>
        resendEmailService.sendDonationRecoveryEmail({
          donor,
          requestId: doc.id,
        }),
      );
      sent += 1;
    }

    console.info('[recovery] abandoned-pickup sweep complete', {
      scanned: snapshot.size,
      emailed: sent,
      tooFresh,
      pastCap: stale,
    });
  },
);
