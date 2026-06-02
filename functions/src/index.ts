// Force-load functions/.env into process.env at module load. The firebase-functions
// emulator does not reliably propagate env vars to the worker process; in prod the
// .env file doesn't exist, so dotenv silently no-ops and Cloud Functions' built-in
// env handling takes over.
//
// Explicit path: dotenv defaults to `${cwd}/.env`, but the emulator runs with cwd at
// the firebase project root (parent of functions/), so a path-less call would miss
// our file. We resolve relative to this module — works whether the JS is at lib/ or
// transpiled elsewhere.
import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
// .env.local — emulator-only overrides (sandbox creds, dev escape hatches).
// CRITICAL: only load it under the emulator. Firebase still SHIPS this file in
// the deploy bundle (it merely skips it for its own env injection), so loading
// it in prod with override:true would clobber the real ROADIE_API_KEY injected
// from Secret Manager and the production base URL — silently putting prod into
// sandbox mode with verification disabled. The FUNCTIONS_EMULATOR guard keeps
// it strictly local; firebase.json `functions.ignore` also excludes it from the
// upload as defense in depth.
if (process.env['FUNCTIONS_EMULATOR'] === 'true') {
  loadDotenv({ path: join(__dirname, '..', '.env.local'), override: true });
}
// .env — deployed config; loaded without override so it never clobbers the real
// ROADIE_API_KEY that Cloud Functions injects from Secret Manager at runtime
// (and the file carries the production base URL).
loadDotenv({ path: join(__dirname, '..', '.env') });
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { isCallableOwnedDoc } from './dispatch-routing.js';
import { isAlreadyExistsError } from './firestore-utils.js';
import {
  CreateContributionSessionPayload,
  CreateDonationRequestPayload,
  DonationStatus,
  DonationSubmissionResult,
  DonorInfo,
  PickupDetails,
} from './models.js';
import { MockRoadieCourierProvider } from './providers/mock-roadie-provider.js';
import { RoadieCourierProvider } from './providers/roadie-provider.js';
import type { CourierDispatchProvider } from './providers/courier-provider.js';
import { GivebutterService } from './services/givebutter.service.js';
import { HubspotService } from './services/hubspot.service.js';
import { ResendEmailService } from './services/resend.service.js';
import { verifyAndDispatchPickup } from './services/dispatch.service.js';
import { generateDropoffReference } from './utils/dropoff-reference.js';
import { WAREHOUSE_ADDRESS } from './constants/warehouse.js';
import {
  createContributionSessionSchema,
  createDonationRequestSchema,
  getPickupDonationMinUsd,
} from './validators.js';

initializeApp();

const db = getFirestore();
// Strip undefined values from documents instead of throwing. The donation
// payload has three optional sub-objects (pickup / shipping / dropoff), only
// one of which is populated per request — without this, the runTransaction
// below fails with "Cannot use \"undefined\" as a Firestore value".
db.settings({ ignoreUndefinedProperties: true });
// Roadie production credential. Bound to every function that dispatches (see the
// `secrets` option on each below); Firebase injects it as process.env.ROADIE_API_KEY
// at runtime, which RoadieCourierProvider reads. Locally it comes from .env.local
// instead, so the emulator runs against the Roadie sandbox.
const roadieApiKey = defineSecret('ROADIE_API_KEY');

// Lazy-init: pick real-vs-mock on first dispatch call. Cloud Functions Gen2 (and the
// emulator) populate process.env per-invocation, not at module load, so a top-level
// check would always see the mock branch when the worker starts cold.
let _courierProvider: CourierDispatchProvider | undefined;
function getCourierProvider(): CourierDispatchProvider {
  if (_courierProvider) return _courierProvider;
  _courierProvider = process.env['ROADIE_API_KEY']
    ? new RoadieCourierProvider()
    : new MockRoadieCourierProvider();
  console.info(
    `[courier] Using ${process.env['ROADIE_API_KEY'] ? 'RoadieCourierProvider' : 'MockRoadieCourierProvider'}`,
  );
  return _courierProvider;
}
const givebutterService = new GivebutterService();
const hubspotService = new HubspotService();
const resendEmailService = new ResendEmailService();

// Send an email at most once per donation_request, keyed by a named flag on the
// doc. Keeps overlapping code paths (callable + onCreate trigger + Givebutter
// webhook recovery) from each emailing the same donor, and survives function
// retries. Each email type uses its own flag name:
//
//   'confirmationEmailSentAt' — success-path emails (pickup / shipping / dropoff)
//   'recoveryEmailSentAt'     — not_found recovery email
//
// Read-then-write is non-transactional on purpose: a duplicate would only be
// wasted bandwidth, and all callers are wrapped in their own happy-path flow,
// so we swallow send failures rather than propagate them.
type EmailIdempotencyFlag = 'confirmationEmailSentAt' | 'recoveryEmailSentAt';

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
      requestId,
      status: 'queued_for_dispatch',
      pickup,
      courierDispatchId,
      nextSteps: buildNextSteps('pickup'),
    }),
  );
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
    // Deterministic doc id: the client sends the same idempotencyKey to this
    // callable AND reuses it in the direct-Firestore fallback, so both collapse
    // onto ONE doc instead of creating two (which would mean two emails). The
    // create-only transaction below makes whoever's second back off. Legacy
    // clients without a key fall back to an auto id (old behavior). See #113 (L1).
    const requestRef = payload.idempotencyKey
      ? db.collection('donation_requests').doc(payload.idempotencyKey)
      : db.collection('donation_requests').doc();

    let status: DonationStatus = 'submitted';
    let dropoffReference: string | undefined;
    let courierDispatchId: string | undefined;
    let verifiedAmountUsd: number | undefined;
    let failureReason: string | undefined;

    if (payload.donationType === 'pickup' && payload.pickup) {
      // Initial status; the synchronous verification below transitions it to a
      // terminal state before this callable returns.
      status = 'verifying_payment';
    }

    if (payload.donationType === 'shipping' && payload.shipping) {
      // The donor ships the package to the warehouse themselves; the doc create
      // is the success moment. A real prepaid-label provider is tracked for v2.
      status = 'awaiting_shipment';
    }

    if (payload.donationType === 'dropoff' && payload.dropoff) {
      status = 'dropoff_requested';
      dropoffReference = generateDropoffReference();
      payload.dropoff.referenceCode = dropoffReference;
    }

    const baseDoc = {
      donationType: payload.donationType,
      donor: payload.donor,
      contribution: payload.contribution,
      pickup: payload.pickup,
      shipping: payload.shipping,
      dropoff: payload.dropoff,
      status,
      createdAt,
      updatedAt: createdAt,
      // Persisted so the verifyContributionAndDispatch trigger (backstop path)
      // forwards the same key to Roadie. db.settings ignoreUndefinedProperties
      // strips this when absent. See #113.
      idempotencyKey: payload.idempotencyKey,
      metadata: {
        ...payload.metadata,
        source: 'public-web',
        courierDispatchId,
      },
    };

    const typedCollectionName = `${payload.donationType}_requests`;

    try {
      await db.runTransaction(async (transaction) => {
        transaction.create(requestRef, baseDoc);
        transaction.create(db.collection(typedCollectionName).doc(requestRef.id), {
          donationRequestId: requestRef.id,
          ...baseDoc,
        });
      });
    } catch (err) {
      if (!isAlreadyExistsError(err)) {
        throw err;
      }
      // Same idempotencyKey already created this donation — the direct-Firestore
      // fallback (or a retry of this callable). Don't duplicate the doc or
      // re-dispatch; whoever created it owns dispatch (its inline path or its
      // onCreate trigger). Return the doc's current state. See #113 (L1).
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
          dropoffReference,
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
          courierProvider: getCourierProvider(),
        },
        payload.idempotencyKey,
      );

      status = verification.status;
      courierDispatchId = verification.courierDispatchId;
      verifiedAmountUsd = verification.verifiedAmountUsd;
      failureReason = verification.failureReason;

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
          ...(verification.courierDispatchId
            ? { courierDispatchId: verification.courierDispatchId }
            : {}),
          ...(verification.verificationTransactionId
            ? { verificationTransactionId: verification.verificationTransactionId }
            : {}),
          ...(verification.verificationMatchType
            ? { verificationMatchType: verification.verificationMatchType }
            : {}),
          ...(verification.failureReason
            ? { verificationFailureReason: verification.failureReason }
            : {}),
        },
        updatedAt: Timestamp.now(),
      };

      await db.runTransaction(async (transaction) => {
        transaction.set(requestRef, update, { merge: true });
        transaction.set(db.collection('pickup_requests').doc(requestRef.id), update, {
          merge: true,
        });
      });

      if (verification.status === 'queued_for_dispatch') {
        await notifyPickupQueued(requestRef.id, payload.donor, payload.pickup!, courierDispatchId);
      } else if (
        verification.status === 'payment_verification_failed' &&
        verification.failureReason === 'not_found'
      ) {
        // Immediate recovery nudge while the wizard surfaces the rejection in-app.
        // Once the 24h scheduled-loop work in #64 lands, this immediate send moves
        // behind an onSchedule trigger that queries stalled donations daily.
        await sendEmailOnce(requestRef.id, 'recoveryEmailSentAt', () =>
          resendEmailService.sendDonationRecoveryEmail({
            donor: payload.donor,
            requestId: requestRef.id,
          }),
        );
      }
    }

    const metaCity =
      typeof payload.metadata?.['city'] === 'string'
        ? (payload.metadata['city'] as string)
        : undefined;
    const metaState =
      typeof payload.metadata?.['state'] === 'string'
        ? (payload.metadata['state'] as string)
        : undefined;
    const city =
      metaCity ?? payload.pickup?.pickupAddress?.city ?? payload.shipping?.senderAddress?.city;
    const state =
      metaState ?? payload.pickup?.pickupAddress?.state ?? payload.shipping?.senderAddress?.state;
    const packageSize =
      typeof payload.metadata?.['packageSize'] === 'string'
        ? (payload.metadata['packageSize'] as string)
        : undefined;

    await hubspotService
      .upsertDonorContact({
        email: payload.donor.email,
        fullName: payload.donor.fullName,
        phone: payload.donor.phone,
        donationMethod: payload.donationType,
        donationAmountUsd: payload.contribution.amountUsd,
        city,
        state,
        packageSize,
      })
      .catch((err) => console.warn('HubSpot upsert failed', err));

    return {
      requestId: requestRef.id,
      donationType: payload.donationType,
      status,
      createdAt: createdAt.toDate().toISOString(),
      dropoffReference,
      courierDispatchId,
      verifiedAmountUsd,
      failureReason,
      nextSteps: buildNextSteps(payload.donationType),
    } satisfies DonationSubmissionResult;
  },
);

export const createContributionSession = onCall({ region: 'us-central1' }, async (request) => {
  const parsed = createContributionSessionSchema.safeParse(request.data);

  if (!parsed.success) {
    throw new HttpsError('invalid-argument', parsed.error.flatten().formErrors.join(' '));
  }

  const payload = parsed.data as CreateContributionSessionPayload;
  return givebutterService.createCheckoutSession(payload);
});

// Authoritative pickup payment gate. Fires on every donation_requests doc create.
// For pickup, looks up Givebutter transactions by donor email + recency window,
// dispatches the courier on success, marks payment_verification_failed (and emails
// the donor) on explicit rejection, or drops to awaiting_payment if Givebutter API
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

    // The createDonationRequest callable creates this doc AND, for pickup, verifies +
    // dispatches it synchronously — and it sends every confirmation email inline. This
    // trigger is only a backstop for the frontend's direct-Firestore fallback, which
    // skips the callable entirely. Acting on a callable-created doc races the callable's
    // inline work — the status guard below isn't enough because the callable writes its
    // terminal status only AFTER dispatching — and books a second courier plus a second
    // email. Bail on callable-owned docs. See #112.
    if (isCallableOwnedDoc(data['metadata'])) {
      return;
    }

    // Shipping + dropoff have no async verification or courier dispatch — the callable's
    // only success-path action for them is the confirmation email (see createDonationRequest).
    // On the fallback path the callable never ran, so nothing sent it; do it here. The
    // 'confirmationEmailSentAt' flag keeps this idempotent across function retries.
    if (data['donationType'] === 'shipping' && data['shipping']) {
      await sendEmailOnce(requestId, 'confirmationEmailSentAt', () =>
        resendEmailService.sendShippingConfirmationEmail({
          donor: data['donor'],
          requestId,
          status: 'awaiting_shipment',
          shipping: data['shipping'],
          warehouseAddress: WAREHOUSE_ADDRESS,
          nextSteps: buildNextSteps('shipping'),
        }),
      );
      return;
    }

    if (data['donationType'] === 'dropoff' && data['dropoff']) {
      await sendEmailOnce(requestId, 'confirmationEmailSentAt', () =>
        resendEmailService.sendDropoffConfirmationEmail({
          donor: data['donor'],
          requestId,
          status: 'dropoff_requested',
          dropoff: data['dropoff'],
          dropoffReference: data['dropoff']?.referenceCode,
          nextSteps: buildNextSteps('dropoff'),
        }),
      );
      return;
    }

    if (data['donationType'] !== 'pickup') {
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
      currentStatus === 'awaiting_payment'
    ) {
      return;
    }

    // Backstop path: the frontend's direct-Firestore-write fallback (used when
    // the callable times out) skips the synchronous verification, so we run it here.
    const verification = await verifyAndDispatchPickup(
      requestId,
      data['donor'],
      data['pickup'],
      {
        givebutterService,
        courierProvider: getCourierProvider(),
      },
      data['idempotencyKey'] as string | undefined,
    );

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
        ...(verification.courierDispatchId
          ? { courierDispatchId: verification.courierDispatchId }
          : {}),
        ...(verification.verificationTransactionId
          ? { verificationTransactionId: verification.verificationTransactionId }
          : {}),
        ...(verification.verificationMatchType
          ? { verificationMatchType: verification.verificationMatchType }
          : {}),
        ...(verification.failureReason
          ? { verificationFailureReason: verification.failureReason }
          : {}),
      },
      updatedAt: Timestamp.now(),
    };

    await snap.ref.set(update, { merge: true });
    await db.collection('pickup_requests').doc(requestId).set(update, { merge: true });

    if (verification.status === 'queued_for_dispatch') {
      await notifyPickupQueued(requestId, data['donor'], data['pickup'], verification.courierDispatchId);
    } else if (
      verification.status === 'payment_verification_failed' &&
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
      console.warn('Givebutter webhook had no matching donation_request', { sessionId, eventType });
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
    // crashed) or awaiting_payment (trigger explicitly fell back due to a Givebutter API
    // error). queued_for_dispatch and payment_verification_failed are skipped — terminal.
    if (
      data?.['donationType'] === 'pickup' &&
      (data?.['status'] === 'awaiting_payment' || data?.['status'] === 'verifying_payment') &&
      typeof completedAmount === 'number' &&
      completedAmount >= getPickupDonationMinUsd()
    ) {
      try {
        const dispatch = await getCourierProvider().dispatchPickup({
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
                courierDispatchId: dispatch.dispatchId,
              },
              updatedAt: Timestamp.now(),
            },
            { merge: true },
          );

        // Mirror the typed-collection doc so downstream readers stay in sync.
        await db
          .collection('pickup_requests')
          .doc(requestId)
          .set(
            {
              status: 'queued_for_dispatch',
              metadata: {
                ...(data['metadata'] ?? {}),
                courierDispatchId: dispatch.dispatchId,
              },
              updatedAt: Timestamp.now(),
            },
            { merge: true },
          );

        await notifyPickupQueued(requestId, data['donor'], data['pickup'], dispatch.dispatchId);
      } catch (err) {
        console.error('Courier dispatch failed after payment confirmation', err);
      }
    } else if (
      data?.['donationType'] === 'pickup' &&
      (data?.['status'] === 'awaiting_payment' || data?.['status'] === 'verifying_payment') &&
      (typeof completedAmount !== 'number' || completedAmount < getPickupDonationMinUsd())
    ) {
      console.warn('Pickup donation below minimum; not dispatching courier', {
        requestId,
        completedAmount,
        minimum: getPickupDonationMinUsd(),
      });
    } else if (
      data?.['donationType'] === 'pickup' &&
      data?.['status'] === 'payment_verification_failed'
    ) {
      // Verification trigger already rejected this; donor was emailed. Manual ops review.
      console.warn('Webhook arrived for already-failed verification; ignoring', {
        requestId,
        completedAmount,
      });
    }

    if (data?.['donor']?.email) {
      const meta = data?.['metadata'] ?? {};
      const docCity =
        (typeof meta['city'] === 'string' ? meta['city'] : undefined) ??
        data?.['pickup']?.pickupAddress?.city ??
        data?.['shipping']?.senderAddress?.city;
      const docState =
        (typeof meta['state'] === 'string' ? meta['state'] : undefined) ??
        data?.['pickup']?.pickupAddress?.state ??
        data?.['shipping']?.senderAddress?.state;
      await hubspotService
        .upsertDonorContact({
          email: data['donor'].email,
          fullName: data['donor'].fullName ?? '',
          phone: data['donor'].phone ?? '',
          donationMethod: data['donationType'],
          donationAmountUsd: completedAmount,
          city: docCity,
          state: docState,
          packageSize: typeof meta['packageSize'] === 'string' ? meta['packageSize'] : undefined,
          refreshOnly: true,
        })
        .catch((err) => console.warn('HubSpot webhook upsert failed', err));
    }
  }

  res.status(200).json({ ok: true });
});

// ============================================================
// Inventory Management System (IMS) functions
// ============================================================
// Called by the warehouse-facing IMS to look up donation metadata
// using the drop-off reference code that donors receive from this app.

export const lookupDonationByReference = onCall({ region: 'us-central1' }, async (request) => {
  const code =
    typeof request.data?.referenceCode === 'string' ? request.data.referenceCode.trim() : '';

  if (!code) {
    throw new HttpsError('invalid-argument', 'referenceCode is required');
  }

  const snapshot = await db
    .collection('donation_requests')
    .where('dropoff.referenceCode', '==', code)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return { found: false };
  }

  const doc = snapshot.docs[0];
  const data = doc.data();

  return {
    found: true,
    requestId: doc.id,
    donationType: data['donationType'],
    status: data['status'],
    donor: data['donor'],
    dropoff: data['dropoff'],
    pickup: data['pickup'],
    shipping: data['shipping'],
    createdAt: data['createdAt']?.toDate?.()?.toISOString?.() ?? null,
  };
});

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
      'After shipping, save your receipt so we can trace delivery if needed.',
    ];
  }

  return [
    'Bring your donation during the selected window.',
    'Share your drop-off reference at check-in for fast verification.',
  ];
}
