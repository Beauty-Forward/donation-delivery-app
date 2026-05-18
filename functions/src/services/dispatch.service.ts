import type { DonorInfo, PickupDetails } from '../models.js';
import type { CourierDispatchProvider } from '../providers/courier-provider.js';
import { GivebutterService } from './givebutter.service.js';
import { getPickupDonationMinUsd } from '../validators.js';

export interface VerifyAndDispatchResult {
  status: 'queued_for_dispatch' | 'awaiting_payment' | 'payment_verification_failed';
  courierDispatchId?: string;
  verifiedAmountUsd?: number;
  verificationTransactionId?: string;
  failureReason?: string;
}

// Pure verification + dispatch — no side-effect emails. The caller in index.ts
// is responsible for sending success/recovery emails via sendEmailOnce after
// inspecting the returned result.
export interface VerifyAndDispatchDeps {
  givebutterService: GivebutterService;
  courierProvider: CourierDispatchProvider;
}

// Pure verification + dispatch. Caller owns persistence — this lets
// createDonationRequest run it inline (returning the result to the donor)
// and verifyContributionAndDispatch use the same code path as a backstop
// for the frontend's direct-Firestore-write fallback.
export async function verifyAndDispatchPickup(
  requestId: string,
  donor: DonorInfo,
  pickup: PickupDetails,
  deps: VerifyAndDispatchDeps
): Promise<VerifyAndDispatchResult> {
  // Dev escape hatch — auto-verify so the team can exercise dispatch without
  // paying through the live widget. Never set in prod.
  if (process.env['SKIP_GIVEBUTTER_VERIFICATION'] === 'true') {
    console.warn('[dev] SKIP_GIVEBUTTER_VERIFICATION is on; auto-verifying pickup', { requestId });
    try {
      const dispatch = await deps.courierProvider.dispatchPickup({ requestId, donor, pickup });
      return {
        status: 'queued_for_dispatch',
        courierDispatchId: dispatch.dispatchId,
        verifiedAmountUsd: getPickupDonationMinUsd(),
        verificationTransactionId: 'dev_skip_verification'
      };
    } catch (err) {
      console.error('Dev-skip dispatch failed', { requestId, err });
      return { status: 'awaiting_payment', failureReason: 'dev_skip_dispatch_failed' };
    }
  }

  if (!donor.email) {
    console.error('Pickup donation_request missing donor.email', { requestId });
    return { status: 'payment_verification_failed', failureReason: 'missing_donor_email' };
  }

  const lookbackMinutes = Number(process.env['GIVEBUTTER_DONATION_LOOKBACK_MINUTES'] ?? 30);
  const verification = await deps.givebutterService.findRecentTransactionForDonor(
    donor.email,
    getPickupDonationMinUsd(),
    lookbackMinutes
  );

  if (verification.kind === 'verified') {
    try {
      const dispatch = await deps.courierProvider.dispatchPickup({ requestId, donor, pickup });
      return {
        status: 'queued_for_dispatch',
        courierDispatchId: dispatch.dispatchId,
        verifiedAmountUsd: verification.amountUsd,
        verificationTransactionId: verification.transactionId
      };
    } catch (err) {
      // Payment is verified but Roadie failed. Leave room for webhook recovery
      // to retry the dispatch.
      console.error('Courier dispatch failed after verification', { requestId, err });
      return {
        status: 'awaiting_payment',
        verifiedAmountUsd: verification.amountUsd,
        verificationTransactionId: verification.transactionId,
        failureReason: 'courier_dispatch_failed'
      };
    }
  }

  if (verification.kind === 'rejected') {
    // Pure verification result — the caller in index.ts handles side effects
    // (writing the doc, sending the recovery email via sendEmailOnce).
    return {
      status: 'payment_verification_failed',
      failureReason: verification.reason
    };
  }

  // verification.kind === 'error' — Givebutter API was unavailable. Don't blame
  // the donor; drop to awaiting_payment so handleGivebutterWebhook can rescue.
  console.warn('Givebutter verification errored; falling back to webhook recovery', {
    requestId,
    reason: verification.reason
  });
  return { status: 'awaiting_payment', failureReason: verification.reason };
}
