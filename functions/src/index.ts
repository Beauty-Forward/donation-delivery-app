// Force-load functions/.env into process.env at module load
import { config as loadDotenv } from 'dotenv';
import { join } from 'path';

// .env.local — emulator-only overrides (sandbox creds, dev escape hatches).
if (process.env['FUNCTIONS_EMULATOR'] === 'true') {
  loadDotenv({ path: join(__dirname, '..', '.env.local'), override: true });
}
// .env — deployed config; loaded without override so it never clobbers secrets in SecretManager
loadDotenv({ path: join(__dirname, '..', '.env') });
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { isCallableOwnedDoc } from './dispatch-routing.js';
import { isAlreadyExistsError } from './firestore-utils.js';
import {
  CreateDonationRequestPayload,
  DonationStatus,
  DonationSubmissionResult,
  DonorInfo,
  PickupDetails,
} from './models.js';
import { RoadieCourierService } from './services/roadie.service.js';
import { GivebutterService } from './services/givebutter.service.js';
import { ResendEmailService } from './services/resend.service.js';
import { verifyAndDispatchPickup, VerifyAndDispatchResult } from './services/dispatch.service.js';
import { WAREHOUSE_ADDRESS } from './warehouse.js';
import { createDonationRequestSchema, getPickupDonationMinUsd } from './validators.js';

initializeApp();

const db = getFirestore();

// without this, we open ourselves up to 'Cannot use "undefined" as a Firestore value' errors
db.settings({ ignoreUndefinedProperties: true });

const roadieApiKey = defineSecret('ROADIE_API_KEY');

let _courierService: RoadieCourierService | undefined;
function getCourierService(): RoadieCourierService {
  if (_courierService) return _courierService;
  _courierService = new RoadieCourierService();
  return _courierService;
}
const givebutterService = new GivebutterService();
const resendEmailService = new ResendEmailService();

// Send an email at most once per donation_request, keyed by a named flag on the
// doc. Keeps overlapping code paths (callable + onCreate trigger + Givebutter
// webhook recovery) from each emailing the same donor, and survives function
// retries. Each email type uses its own flag name:
//
//   'confirmationEmailSentAt' — success-path emails (pickup / shipping / dropoff)
//   'recoveryEmailSentAt'     — not_found recovery email
//   'slaEmailSentAt'          — 24h "we're on it" email for payment_verification_failed and awaiting_dispatch stalls
//
// Read-then-write is non-transactional on purpose: a duplicate would only be
// wasted bandwidth, and all callers are wrapped in their own happy-path flow,
// so we swallow send failures rather than propagate them.
type EmailIdempotencyFlag = 'confirmationEmailSentAt' | 'recoveryEmailSentAt' | 'slaEmailSentAt';

async function sendEmailOnce(
  requestId: string,
  flagName: EmailIdempotencyFlag,
  send: () => Promise<void>,
): Promise<void> {
  const ref = db.collection('donation_requests').doc(requestId);
  const snap = await ref.get();
  if (snap.data()?.[flagName]) {
    console.info('[resend] skip: already sent', { requestId, flagName });
    return;
  }
  console.info('[resend] attempting send', {
    requestId,
    flagName,
    apiKeyConfigured: (process.env['RESEND_API_KEY'] ?? '').length > 0,
    fromEmail: process.env['RESEND_FROM_EMAIL'] ?? 'onboarding@resend.dev',
  });
  try {
    await send();
    await ref.set({ [flagName]: Timestamp.now() }, { merge: true });
    console.info('[resend] send completed', { requestId, flagName });
  } catch (err) {
    console.warn('Email send failed', { requestId, flagName, err });
  }
}

// A pickup_request hits `queued_for_dispatch` via three different code paths:
// the synchronous callable, the onCreate backstop trigger, and the Givebutter
// webhook recovery. Each used to inline the same pickup-confirmation send.
// Centralizing here so the email payload (and any future tweaks like analytics
// hooks) lives in one place.
async function notifyPickupQueued(
  requestId: string,
  donor: DonorInfo,
  pickup: PickupDetails,
  courierDispatchId: string | undefined,
): Promise<void> {
  await sendEmailOnce(requestId, 'confirmationEmailSentAt', () =>
    resendEmailService.sendPickupConfirmationEmail({
      donor,
      status: 'queued_for_dispatch',
      pickup,
      nextSteps: buildNextSteps('pickup'),
    }),
  );
}

function getVerificationMetadata(v: VerifyAndDispatchResult) {
  switch (v.status) {
    case 'queued_for_dispatch':
      return {
        courierDispatchId: v.courierDispatchId,
        verificationTransactionId: v.verificationTransactionId,
        verifiedAmountUsd: v.verifiedAmountUsd,
      };
    case 'awaiting_dispatch':
      return {
        verificationTransactionId: v.verificationTransactionId,
        verifiedAmountUsd: v.verifiedAmountUsd,
      };
    case 'payment_not_found':
    case 'payment_verification_failed':
      return {
        verificationFailureReason: v.failureReason,
      };
  }
}

export const createDonationRequest = onCall(
  { region: 'us-central1', timeoutSeconds: 60, memory: '512MiB', secrets: [roadieApiKey] },
  async (request) => {
    const parsed = createDonationRequestSchema.safeParse(request.data);

    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.flatten().formErrors.join(' '));
    }

    const payload = parsed.data as CreateDonationRequestPayload;
    const createdAt = Timestamp.now();

    const requestRef = db.collection('donation_requests').doc(payload.requestId);

    let status: DonationStatus = 'submitted';
    let courierDispatchId: string | undefined;
    let verifiedAmountUsd: number | undefined;
    let failureReason: string | undefined;

    if (payload.donationType === 'pickup' && payload.pickup) {
      // Initial status; the synchronous verification below transitions it to a
      // terminal state before this callable returns.
      if (process.env['SKIP_GIVEBUTTER_VERIFICATION'] === 'true') {
        status = 'queued_for_dispatch';
      } else {
        status = 'verifying_payment';
      }
    }

    if (payload.donationType === 'shipping' && payload.shipping) {
      status = 'awaiting_shipment';
    }

    if (payload.donationType === 'dropoff' && payload.dropoff) {
      status = 'dropoff_requested';
    }

    const baseDoc = {
      requestId: payload.requestId,
      donationType: payload.donationType,
      donor: payload.donor,
      contribution: payload.contribution,
      pickup: payload.pickup,
      shipping: payload.shipping,
      dropoff: payload.dropoff,
      status,
      createdAt,
      updatedAt: createdAt,
      metadata: {
        ...payload.metadata,
        source: 'public-web',
        courierDispatchId,
      },
    };

    try {
      await db.runTransaction(async (transaction) => {
        transaction.create(requestRef, baseDoc);
      });
    } catch (err) {
      if (!isAlreadyExistsError(err)) {
        throw err;
      }

      const existing = (await requestRef.get()).data() ?? {};
      const existingMeta = (existing['metadata'] ?? {}) as Record<string, unknown>;
      return {
        requestId: requestRef.id,
        donationType: payload.donationType,
        status: (existing['status'] as DonationStatus) ?? status,
        createdAt: createdAt.toDate().toISOString(),
        courierDispatchId: existingMeta['courierDispatchId'] as string | undefined,
        nextSteps: buildNextSteps(payload.donationType),
      } satisfies DonationSubmissionResult;
    }

    // Shipping + dropoff have no async verification step — the doc create *is* the
    // success moment, so email the donor here. Pickup waits until verification +
    // dispatch resolves below.
    if (payload.donationType === 'shipping' && payload.shipping) {
      await sendEmailOnce(requestRef.id, 'confirmationEmailSentAt', () =>
        resendEmailService.sendShippingConfirmationEmail({
          donor: payload.donor,
          requestId: requestRef.id,
          status: 'awaiting_shipment',
          shipping: payload.shipping!,
          warehouseAddress: WAREHOUSE_ADDRESS,
          nextSteps: buildNextSteps('shipping'),
        }),
      );
    }

    if (payload.donationType === 'dropoff' && payload.dropoff) {
      await sendEmailOnce(requestRef.id, 'confirmationEmailSentAt', () =>
        resendEmailService.sendDropoffConfirmationEmail({
          donor: payload.donor,
          requestId: requestRef.id,
          status: 'dropoff_requested',
          dropoff: payload.dropoff!,
          nextSteps: buildNextSteps('dropoff'),
        }),
      );
    }

    // For pickups, gate the response on real Givebutter verification + Roadie dispatch
    // so the donor sees the actual outcome on the confirmation page (not an optimistic
    // "verifying" state). The verifyContributionAndDispatch trigger still runs on the
    // create above as a backstop for the frontend's direct-Firestore-write fallback path.
    if (payload.donationType === 'pickup' && payload.pickup) {
      const verification = await verifyAndDispatchPickup(
        requestRef.id,
        payload.donor,
        payload.pickup,
        {
          givebutterService,
          courierService: getCourierService(),
        },
      );

      if (verification.status === 'queued_for_dispatch') {
        courierDispatchId = verification.courierDispatchId;
        verifiedAmountUsd = verification.verifiedAmountUsd;
      } else {
        failureReason = verification.failureReason;
      }

      status = verification.status;
      const update = {
        status,
        contribution: {
          ...payload.contribution,
          ...(verification.status === 'queued_for_dispatch'
            ? { status: 'completed' as const, amountUsd: verification.verifiedAmountUsd }
            : {}),
        },
        metadata: {
          ...(baseDoc.metadata ?? {}),
          ...getVerificationMetadata(verification),
        },
        updatedAt: Timestamp.now(),
      };

      await requestRef.set(update, { merge: true });

      if (verification.status === 'queued_for_dispatch') {
        await notifyPickupQueued(requestRef.id, payload.donor, payload.pickup!, courierDispatchId);
      } else if (
        verification.status === 'payment_not_found' &&
        verification.failureReason === 'not_found'
      ) {
        // Immediate recovery nudge while the wizard surfaces the rejection in-app.
        // This stays inline (not in the sendStalledDonationSlaEmails loop): a
        // 'not_found' result means Givebutter found no payment, so it's an abandoned-
        // cart nudge, not a payment_verification_failed SLA case. The scheduled loop owns the
        // awaiting_dispatch and payment_verification_failed stalls (courier failure / Givebutter API error).
        await sendEmailOnce(requestRef.id, 'recoveryEmailSentAt', () =>
          resendEmailService.sendDonationRecoveryEmail({
            donor: payload.donor,
            requestId: requestRef.id,
          }),
        );
      }
    }

    return {
      requestId: requestRef.id,
      donationType: payload.donationType,
      status,
      createdAt: createdAt.toDate().toISOString(),
      courierDispatchId,
      verifiedAmountUsd,
      failureReason,
      nextSteps: buildNextSteps(payload.donationType),
    } satisfies DonationSubmissionResult;
  },
);

// Authoritative pickup payment gate. Fires on every donation_requests doc create.
// For pickup, looks up Givebutter transactions by donor email + recency window,
// dispatches the courier on success, marks payment_not_found (and emails
// the donor) on explicit rejection, or drops to payment_verification_failed if Givebutter API
// errors so ops can rescue. Non-pickup donations short-circuit immediately.
//
// Why email-based lookup instead of sessionId: the Givebutter Widgets SDK doesn't
// reliably propagate donation.complete events from the iframe to the parent page
// (especially when Google Pay popups are involved), so we can't capture a sessionId
// client-side. Donor explicitly clicks "I've completed my donation" in the wizard;
// we trust the click and verify against Givebutter on the backend.
export const verifyContributionAndDispatch = onDocumentCreated(
  { region: 'us-central1', document: 'donation_requests/{requestId}', secrets: [roadieApiKey] },
  async (event) => {
    const snap = event.data;
    if (!snap) {
      return;
    }
    const data = snap.data();
    const requestId = event.params['requestId'];

    if (data['donationType'] !== 'pickup') {
      return;
    }

    // The createDonationRequest callable creates this doc AND verifies + dispatches
    // it synchronously. This trigger is only a backstop for the frontend's direct-
    // Firestore fallback. Acting on a callable-created doc races the callable's
    // inline dispatch — the status guard below isn't enough because the callable
    // writes its terminal status only AFTER dispatching — and books a second
    // courier plus a second email. Bail on callable-owned docs. See #112.
    if (isCallableOwnedDoc(data['metadata'])) {
      return;
    }

    // Re-read the current doc state. The synchronous createDonationRequest callable
    // writes the doc, then runs verification, then updates the doc to a terminal
    // status. The onCreate trigger fires off the initial write and would race with
    // the callable's update — bail if the callable already settled this doc.
    const fresh = await snap.ref.get();
    const currentStatus = fresh.data()?.['status'] as DonationStatus | undefined;
    if (
      currentStatus === 'queued_for_dispatch' ||
      currentStatus === 'payment_verification_failed' ||
      currentStatus === 'payment_not_found'
    ) {
      return;
    }

    // Backstop path: the frontend's direct-Firestore-write fallback (used when
    // the callable times out) skips the synchronous verification, so we run it here.
    const verification = await verifyAndDispatchPickup(requestId, data['donor'], data['pickup'], {
      givebutterService,
      courierService: getCourierService(),
    });

    const update = {
      status: verification.status,
      contribution: {
        ...(data['contribution'] ?? {}),
        ...(verification.status === 'queued_for_dispatch'
          ? { status: 'completed', amountUsd: verification.verifiedAmountUsd }
          : {}),
      },
      metadata: {
        ...(data['metadata'] ?? {}),
        ...getVerificationMetadata(verification),
      },
      updatedAt: Timestamp.now(),
    };

    await snap.ref.set(update, { merge: true });

    if (verification.status === 'queued_for_dispatch') {
      await notifyPickupQueued(
        requestId,
        data['donor'],
        data['pickup'],
        verification.courierDispatchId,
      );
    } else if (
      verification.status === 'payment_not_found' &&
      verification.failureReason === 'not_found'
    ) {
      // Backstop recovery send for the direct-Firestore-write fallback path,
      // mirroring the inline send in createDonationRequest. See #64.
      await sendEmailOnce(requestId, 'recoveryEmailSentAt', () =>
        resendEmailService.sendDonationRecoveryEmail({
          donor: data['donor'],
          requestId,
        }),
      );
    }
  },
);

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

export const handleGivebutterWebhook = onRequest(
  { region: 'us-central1', secrets: [roadieApiKey] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const eventType = typeof req.body?.type === 'string' ? req.body.type : 'unknown';

    // Resolve the donation_request from the webhook payload. The wizard captures
    // `gbSessionId` from the embedded widget's donation.complete event and stores it
    // on `contribution.gbSessionId`; Givebutter echoes the same id in webhook payloads.
    // Fields vary slightly by event type, so check the common spots.
    const sessionId: string | undefined =
      (typeof req.body?.data?.session_id === 'string' && req.body.data.session_id) ||
      (typeof req.body?.data?.transaction?.session_id === 'string' &&
        req.body.data.transaction.session_id) ||
      (typeof req.body?.data?.id === 'string' && req.body.data.id) ||
      undefined;

    // TODO: Validate Givebutter webhook signatures before processing production traffic.
    if (sessionId && eventType.includes('payment')) {
      const matches = await db
        .collection('donation_requests')
        .where('contribution.gbSessionId', '==', sessionId)
        .limit(1)
        .get();

      if (matches.empty) {
        console.warn('Givebutter webhook had no matching donation_request', {
          sessionId,
          eventType,
        });
        res.status(200).json({ ok: true, matched: false });
        return;
      }

      const matchedDoc = matches.docs[0];
      const requestId = matchedDoc.id;

      await db
        .collection('donation_requests')
        .doc(requestId)
        .set(
          {
            contribution: {
              status: 'completed',
            },
            updatedAt: Timestamp.now(),
          },
          { merge: true },
        );

      const snapshot = await db.collection('donation_requests').doc(requestId).get();
      const data = snapshot.data();
      const completedAmount =
        typeof req.body?.data?.amount === 'number'
          ? req.body.data.amount
          : data?.['contribution']?.amountUsd;

      // Pickup gate: dispatch the courier only after we've confirmed payment >= the minimum.
      // The webhook is a recovery path now (the verifyContributionAndDispatch trigger is the
      // primary gate); accept either verifying_payment (trigger never resolved, e.g. function
      // crashed) or payment_verification_failed (trigger explicitly fell back due to a Givebutter API
      // error). queued_for_dispatch and payment_not_found are skipped — terminal.
      if (
        data?.['donationType'] === 'pickup' &&
        (data?.['status'] === 'payment_verification_failed' ||
          data?.['status'] === 'verifying_payment') &&
        typeof completedAmount === 'number' &&
        completedAmount >= getPickupDonationMinUsd()
      ) {
        try {
          const dispatchId = await getCourierService().dispatchPickup({
            requestId,
            donor: data['donor'],
            pickup: data['pickup'],
          });

          await db
            .collection('donation_requests')
            .doc(requestId)
            .set(
              {
                status: 'queued_for_dispatch',
                metadata: {
                  ...(data['metadata'] ?? {}),
                  courierDispatchId: dispatchId,
                },
                updatedAt: Timestamp.now(),
              },
              { merge: true },
            );

          await notifyPickupQueued(requestId, data['donor'], data['pickup'], dispatchId);
        } catch (err) {
          console.error('Courier dispatch failed after payment confirmation', err);
        }
      } else if (
        data?.['donationType'] === 'pickup' &&
        (data?.['status'] === 'payment_verification_failed' ||
          data?.['status'] === 'verifying_payment') &&
        (typeof completedAmount !== 'number' || completedAmount < getPickupDonationMinUsd())
      ) {
        console.warn('Pickup donation below minimum; not dispatching courier', {
          requestId,
          completedAmount,
          minimum: getPickupDonationMinUsd(),
        });
      } else if (data?.['donationType'] === 'pickup' && data?.['status'] === 'payment_not_found') {
        // Verification trigger already rejected this; donor was emailed. Manual ops review.
        console.warn('Webhook arrived for already-failed verification; ignoring', {
          requestId,
          completedAmount,
        });
      }
    }

    res.status(200).json({ ok: true });
  },
);

function buildNextSteps(type: CreateDonationRequestPayload['donationType']): string[] {
  if (type === 'pickup') {
    return [
      'We will confirm your courier assignment by email and text shortly.',
      'Please keep your donation packed and accessible during your selected window.',
    ];
  }

  if (type === 'shipping') {
    return [
      'Ship your items to the warehouse address shown above.',
      'After shipping, email us your tracking number so that we can track delivery.',
    ];
  }

  return [
    'Bring your donation during the selected window.',
    "Leave your package with the front desk. Tell them it's for Beauty Forward.",
  ];
}
