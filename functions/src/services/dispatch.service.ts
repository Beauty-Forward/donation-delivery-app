import type { DonorInfo, PickupDetails } from '../models.js';
import type { RoadieCourierService } from './roadie.service.js';
import { GivebutterService, type VerificationMatchType } from './givebutter.service.js';
import { getPickupDonationMinUsd } from '../validators.js';

export type VerifyAndDispatchResult =
  | {
      status: 'queued_for_dispatch';
      courierDispatchId: string;
      verifiedAmountUsd: number;
      verificationTransactionId: string;
      verificationMatchType: VerificationMatchType | 'skipped';
    }
  | { status: 'awaiting_payment'; failureReason: string }
  | {
      status: 'awaiting_dispatch';
      verifiedAmountUsd: number;
      verificationTransactionId: string;
      verificationMatchType: VerificationMatchType;
      failureReason: string;
    }
  | { status: 'payment_verification_failed'; failureReason: string };
export interface VerifyAndDispatchDeps {
  givebutterService: GivebutterService;
  courierService: RoadieCourierService;
}

export async function verifyAndDispatchPickup(
  requestId: string,
  donor: DonorInfo,
  pickup: PickupDetails,
  deps: VerifyAndDispatchDeps,
  idempotencyKey?: string,
): Promise<VerifyAndDispatchResult> {
  if (process.env['SKIP_GIVEBUTTER_VERIFICATION'] === 'true') {
    console.warn('[dev] SKIP_GIVEBUTTER_VERIFICATION is on; auto-verifying pickup', { requestId });
    try {
      const dispatch = await deps.courierService.dispatchPickup({
        requestId,
        donor,
        pickup,
        idempotencyKey,
      });
      return {
        status: 'queued_for_dispatch',
        courierDispatchId: dispatch.dispatchId,
        verifiedAmountUsd: getPickupDonationMinUsd(),
        verificationTransactionId: 'dev_skip_verification',
        verificationMatchType: 'skipped',
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
    donor.fullName,
    getPickupDonationMinUsd(),
    lookbackMinutes,
  );

  if (verification.kind === 'verified') {
    try {
      const dispatch = await deps.courierService.dispatchPickup({
        requestId,
        donor,
        pickup,
        idempotencyKey,
      });
      return {
        status: 'queued_for_dispatch',
        courierDispatchId: dispatch.dispatchId,
        verifiedAmountUsd: verification.amountUsd,
        verificationTransactionId: verification.transactionId,
        verificationMatchType: verification.matchType,
      };
    } catch (err) {
      console.error('Courier dispatch failed after verification', { requestId, err });
      return {
        status: 'awaiting_dispatch',
        verifiedAmountUsd: verification.amountUsd,
        verificationTransactionId: verification.transactionId,
        verificationMatchType: verification.matchType,
        failureReason: 'courier_dispatch_failed', // TODO: surface Roadie error
      };
    }
  }

  if (verification.kind === 'rejected') {
    return {
      status: 'payment_verification_failed',
      failureReason: verification.reason,
    };
  }

  // verification.kind === 'error' — Givebutter API was unavailable.
  console.warn('Givebutter verification errored; falling back to webhook recovery', {
    requestId,
    reason: verification.reason,
  });
  return { status: 'awaiting_payment', failureReason: verification.reason };
}
