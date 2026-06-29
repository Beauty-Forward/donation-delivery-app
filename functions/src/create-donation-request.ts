import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createDonationRequestSchema } from './validators.js';
import {
  CreateDonationRequestPayload,
  DonationStatus,
  DonationSubmissionResult,
} from './models.js';
import { isAlreadyExistsError } from './firestore-utils.js';
import { ResendEmailService } from './services/resend.service.js';
import { WAREHOUSE_ADDRESS } from './warehouse.js';
import { sendEmailOnce, buildNextSteps } from './givebutter-webhook.js';

// Create-only. Validates the payload and persists the donation doc with its
// logistics, then stops — the rest of the flow is event-driven:
//   - pickup:  lands in `verifying_payment` and returns. The Givebutter webhook
//              (handleGivebutterWebhook) confirms payment, dispatches the courier,
//              and sends the confirmation email.
//   - shipping / dropoff: no payment step, so the doc create IS the success
//              moment — send the confirmation email inline here.
export const createDonationRequest = onCall(
  { region: 'us-central1' },
  async (request): Promise<DonationSubmissionResult> => {
    const parsed = createDonationRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.flatten().formErrors.join(' '));
    }
    const payload = parsed.data as CreateDonationRequestPayload;

    const db = getFirestore();
    const createdAt = Timestamp.now();
    const requestRef = db.collection('donation_requests').doc(payload.requestId);

    const status: DonationStatus =
      payload.donationType === 'pickup'
        ? 'verifying_payment'
        : payload.donationType === 'shipping'
          ? 'awaiting_shipment'
          : 'dropoff_requested';

    const baseDoc = {
      ...payload,
      status,
      createdAt,
      updatedAt: createdAt,
      metadata: { ...payload.metadata, source: 'public-web' },
    };

    // `create()` fails with ALREADY_EXISTS if the doc is already there — the
    // frontend's direct-Firestore fallback (or a retry) may have created it first.
    // Treat that as success: return what's persisted instead of clobbering it.
    try {
      await requestRef.create(baseDoc);
    } catch (err) {
      if (!isAlreadyExistsError(err)) throw err;
      const existing = (await requestRef.get()).data() ?? {};
      return {
        requestId: requestRef.id,
        donationType: payload.donationType,
        status: (existing['status'] as DonationStatus) ?? status,
        createdAt: createdAt.toDate().toISOString(),
        nextSteps: buildNextSteps(payload.donationType),
      } satisfies DonationSubmissionResult;
    }

    // Pickup waits for the webhook to confirm payment. Shipping/dropoff have no
    // payment step, so creation is the success moment — email the donor now.
    if (payload.donationType === 'shipping' && payload.shipping) {
      const resend = new ResendEmailService();
      await sendEmailOnce(requestRef.id, 'confirmationEmailSentAt', () =>
        resend.sendShippingConfirmationEmail({
          donor: payload.donor,
          requestId: requestRef.id,
          status: 'awaiting_shipment',
          shipping: payload.shipping!,
          warehouseAddress: WAREHOUSE_ADDRESS,
          nextSteps: buildNextSteps('shipping'),
        }),
      );
    } else if (payload.donationType === 'dropoff' && payload.dropoff) {
      const resend = new ResendEmailService();
      await sendEmailOnce(requestRef.id, 'confirmationEmailSentAt', () =>
        resend.sendDropoffConfirmationEmail({
          donor: payload.donor,
          requestId: requestRef.id,
          status: 'dropoff_requested',
          dropoff: payload.dropoff!,
          nextSteps: buildNextSteps('dropoff'),
        }),
      );
    }

    return {
      requestId: requestRef.id,
      donationType: payload.donationType,
      status,
      createdAt: createdAt.toDate().toISOString(),
      nextSteps: buildNextSteps(payload.donationType),
    } satisfies DonationSubmissionResult;
  },
);
