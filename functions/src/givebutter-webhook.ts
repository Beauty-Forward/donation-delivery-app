import { onRequest } from 'firebase-functions/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getPickupDonationMinUsd } from './validators.js';
import { RoadieCourierService } from './services/roadie.service.js';
import { DonorInfo, PickupDetails, CreateDonationRequestPayload } from './models.js';
import { ResendEmailService } from './services/resend.service.js';
import { isValidGivebutterSignature } from './webhook-signature.js';
import { defineSecret } from 'firebase-functions/params';

const db = getFirestore();

const resendEmailService = new ResendEmailService();

const roadieApiKey = defineSecret('ROADIE_API_KEY');

// Givebutter's per-webhook signing secret. It arrives as the `Signature` header on
// every delivery and must equal the value shown for this webhook in the Givebutter
// dashboard. Set it with: firebase functions:secrets:set GIVEBUTTER_WEBHOOK_SIGNATURE
const givebutterWebhookSecret = defineSecret('GIVEBUTTER_WEBHOOK_SIGNATURE');

let _courierService: RoadieCourierService | undefined;
function getCourierService(): RoadieCourierService {
  if (_courierService) return _courierService;
  _courierService = new RoadieCourierService();
  return _courierService;
}

export const handleGivebutterWebhook = onRequest(
  { region: 'us-central1', secrets: [roadieApiKey, givebutterWebhookSecret] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Authenticate the request before trusting anything in it. We treat
    // req.body.data.amount as proof the donor paid and book a real courier off it,
    // so without this check anyone could POST a forged payload (a guessed requestId
    // plus any amount) and dispatch a courier for free. Givebutter sends this
    // webhook's signing secret in the `Signature` header on every delivery.
    const expectedSignature = process.env['GIVEBUTTER_WEBHOOK_SIGNATURE'];
    if (!expectedSignature) {
      // Fail closed: with no secret configured we cannot authenticate anything, so
      // reject rather than silently accept unauthenticated traffic.
      console.error('[webhook] GIVEBUTTER_WEBHOOK_SIGNATURE not set; rejecting request');
      res.status(500).json({ error: 'Webhook not configured' });
      return;
    }
    if (!isValidGivebutterSignature(req.get('Signature'), expectedSignature)) {
      console.warn('[webhook] rejected: missing or invalid Signature header');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // req.body.data.utm_parameters.utm_campaign into requestId, with a typeof … === 'string'
    const requestId: string | undefined =
      typeof req.body?.data?.utm_parameters?.utm_campaign === 'string' &&
      req.body.data.utm_parameters.utm_campaign
        ? req.body.data.utm_parameters.utm_campaign
        : undefined;

    if (!requestId) {
      console.warn('No utm campaign on Givebutter transaction', {
        requestId,
      });
      res.status(200).json({ ok: true, matched: false });
      return;
    }

    const donationRequest = await db.collection('donation_requests').doc(requestId).get();
    const docDonationData = donationRequest.data();

    if (!docDonationData) {
      console.warn('Givebutter webhook had no matching donation request', {
        requestId,
      });
      res.status(200).json({ ok: true, matched: false });
      return;
    }

    if (
      docDonationData.donationType === 'pickup' &&
      docDonationData.status === 'verifying_payment' &&
      req.body.data.amount >= getPickupDonationMinUsd()
    ) {
      try {
        const dispatchId = await getCourierService().dispatchPickup({
          requestId,
          donor: docDonationData['donor'],
          pickup: docDonationData['pickup'],
        });

        await db
          .collection('donation_requests')
          .doc(requestId)
          .set(
            {
              status: 'queued_for_dispatch',
              metadata: {
                ...(docDonationData['metadata'] ?? {}),
                courierDispatchId: dispatchId,
              },
              updatedAt: Timestamp.now(),
            },
            { merge: true },
          );

        await notifyPickupQueued(
          requestId,
          docDonationData['donor'],
          docDonationData['pickup'],
          dispatchId,
        );
      } catch (err) {
        console.error('Courier dispatch failed after payment confirmation', err);
        // Payment is confirmed (we passed the amount check); only the Roadie booking
        // failed. Mark dispatch_failed so the SLA sweep can reassure the donor and
        // flag it for ops, and stash the confirmed amount for that email.
        await db
          .collection('donation_requests')
          .doc(requestId)
          .set(
            {
              status: 'dispatch_failed',
              metadata: {
                ...(docDonationData['metadata'] ?? {}),
                verifiedAmountUsd: req.body.data.amount,
              },
              updatedAt: Timestamp.now(),
            },
            { merge: true },
          );
      }
    }

    res.status(200).json({ ok: true });
  },
);

// The Givebutter webhook is now the only path to `queued_for_dispatch`. Kept as
// its own helper so the confirmation-email payload (and any future tweaks like
// analytics hooks) lives in one place rather than inline in the handler.
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

type EmailIdempotencyFlag = 'confirmationEmailSentAt' | 'recoveryEmailSentAt' | 'slaEmailSentAt';
export async function sendEmailOnce(
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

  if (!process.env['RESEND_API_KEY']) {
    console.warn('[resend] api key not configured. Email not sent', { requestId, flagName });
    return;
  }

  if (
    !process.env['RESEND_FROM_EMAIL'] ||
    process.env['RESEND_FROM_EMAIL'] === 'onboarding@resend.dev'
  ) {
    console.info(
      '[resend] attempting send from LOCAL ENV. Will only send to the email that owns the resend account.',
    );
  } else {
    console.info('[resend] attempting send', { requestId, flagName });
  }

  try {
    await send();
    await ref.set({ [flagName]: Timestamp.now() }, { merge: true });
    console.info('[resend] send completed', { requestId, flagName });
  } catch (err) {
    console.warn('Email send failed', { requestId, flagName, err });
  }
}

export function buildNextSteps(type: CreateDonationRequestPayload['donationType']): string[] {
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
