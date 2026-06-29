import { sendEmailOnce } from './givebutter-webhook.js';
import { onSchedule } from 'firebase-functions/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { ResendEmailService } from './services/resend.service';
import { DonorInfo } from './models';

const db = getFirestore();

const resendEmailService = new ResendEmailService();

// Honors the confirmation page's "we'll email you within 24 hours" promise for the
// two pickup stalls that land in payment_verification_failed:
//   - courier_dispatch_failed: Givebutter verified payment, only Roadie booking failed
//   - any other failureReason:  Givebutter's API errored, so payment is still unknown
//
// Runs hourly and emails each stalled pickup exactly once (slaEmailSentAt flag).
// Because it queries live state, a doc the Givebutter webhook already rescued
// (now queued_for_dispatch) no longer matches, so we never send a redundant
// "we're having trouble" note. Firestore can't filter on a missing field, so we
// query by status and filter slaEmailSentAt / recency in memory — the payment_verification_failed
// set is tiny.
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
      .where('status', 'in', ['payment_verification_failed', 'awaiting_dispatch'])
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

      // 'awaiting_dispatch' means payment was verified — reassure with the
      // verified amount. Anything else is a Givebutter API error (payment unknown).
      const situation =
        data.status === 'awaiting_dispatch' ? 'dispatch_delayed' : 'payment_pending';
      const verifiedAmountUsd =
        typeof data['metadata']?.['verifiedAmountUsd'] === 'number'
          ? (data['metadata']['verifiedAmountUsd'] as number)
          : undefined;

      await sendEmailOnce(doc.id, 'slaEmailSentAt', () =>
        resendEmailService.sendStalledPickupEmail({
          donor,
          requestId: doc.id,
          situation,
          verifiedAmountUsd: situation === 'dispatch_delayed' ? verifiedAmountUsd : undefined,
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

// Daily backstop for the immediate payment_not_found recovery email.
// That nudge fires inline from createDonationRequest / verifyContributionAndDispatch
// the moment Givebutter rejects a pickup ('not_found'), but a transient Resend
// outage — or a cold-start crash after the send but before sendEmailOnce stamps the
// flag — would leave the donor with no email and the doc stuck in
// payment_not_found forever. This sweep re-sends through the SAME
// recoveryEmailSentAt flag, so a donor who already got the immediate email is never
// emailed twice. A doc the donor rescued late (paid -> webhook -> queued_for_dispatch)
// no longer matches the status query, so it's never nudged.
//
// Two age gates bound the sweep. MIN_AGE: only docs stalled past 24h qualify, giving
// the immediate send (and any late webhook) time to settle before we step in.
// RECENCY_CAP: a fresh deploy (or a backlog) must not blast ancient failures that are
// well past any reasonable recovery window and belong to manual ops cleanup; those are
// logged instead. Firestore can't filter on a missing field, so we query by status and
// filter recoveryEmailSentAt / age in memory — the failed set is tiny.

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
      .where('status', '==', 'payment_not_found')
      .get();

    let sent = 0;
    let tooFresh = 0;
    let stale = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();

      // payment_verification_failed only ever lands on pickups (verification runs
      // for pickup alone), and the recovery copy is pickup-specific. Guard anyway.
      if (data['donationType'] !== 'pickup') {
        continue;
      }
      if (data['recoveryEmailSentAt']) {
        continue;
      }

      const createdAt = data['createdAt'] as Timestamp | undefined;
      if (!createdAt) {
        console.warn('[recovery] verification-failed doc missing createdAt; skipping', {
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
          '[recovery] verification-failed doc past recency cap; needs manual ops review',
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
        console.warn('[recovery] verification-failed doc missing donor email; skipping', {
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

    console.info('[recovery] stalled verification-failed sweep complete', {
      scanned: snapshot.size,
      emailed: sent,
      tooFresh,
      pastCap: stale,
    });
  },
);
