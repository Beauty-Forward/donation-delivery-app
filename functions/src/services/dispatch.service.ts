import type { DonorInfo, PickupDetails } from '../models.js';
import type { RoadieCourierService } from './roadie.service.js';
import { GivebutterService } from './givebutter.service.js';

export type VerifyAndDispatchResult =
  | {
      status: 'queued_for_dispatch';
      courierDispatchId: string;
      verifiedAmountUsd: number;
      verificationTransactionId: string;
    }
  | {
      status: 'awaiting_dispatch';
      verifiedAmountUsd: number;
      verificationTransactionId: string;
      failureReason: string;
    }
  | { status: 'payment_not_found'; failureReason: string }
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
): Promise<VerifyAndDispatchResult> {
  if (process.env['SKIP_GIVEBUTTER_VERIFICATION'] === 'true') {
    console.warn('[dev] SKIP_GIVEBUTTER_VERIFICATION is on; auto-verifying pickup', { requestId });
    const dispatchId = await deps.courierService.dispatchPickup({
      requestId,
      donor,
      pickup,
    });
    return {
      status: 'queued_for_dispatch',
      courierDispatchId: dispatchId,
      verifiedAmountUsd: 0, // Hardcoded at 0 because we run this path locally for testing. Re-review if we ever wanted to allow this in prod.
      verificationTransactionId: 'dev_skip_verification',
    };
  }

  const verification = await deps.givebutterService.findRecentTransactionForDonor(requestId);

  if (verification.outcome === 'verified') {
    try {
      const dispatchId = await deps.courierService.dispatchPickup({
        requestId,
        donor,
        pickup,
      });
      return {
        status: 'queued_for_dispatch',
        courierDispatchId: dispatchId,
        verifiedAmountUsd: verification.amountUsd,
        verificationTransactionId: verification.transactionId,
      };
    } catch (err) {
      console.error('Courier dispatch failed after verification', { requestId, err });
      return {
        status: 'awaiting_dispatch',
        verifiedAmountUsd: verification.amountUsd,
        verificationTransactionId: verification.transactionId,
        failureReason: 'courier_dispatch_failed',
      };
    }
  }

  if (verification.outcome === 'rejected') {
    return {
      status: 'payment_not_found',
      failureReason: verification.reason,
    };
  }

  // verification.outcome === 'error' — Givebutter API was unavailable.
  console.warn('Givebutter verification errored; falling back to webhook recovery', {
    requestId,
    reason: verification.reason,
  });
  return { status: 'payment_verification_failed', failureReason: verification.reason };
}
