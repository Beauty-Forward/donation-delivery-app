import { CourierDispatchResult, DonorInfo, PickupDetails } from '../models.js';

export interface CourierDispatchInput {
  requestId: string;
  donor: DonorInfo;
  pickup: PickupDetails;
  // Stable across retries of the same donation (client-generated; shared by the
  // callable and the direct-Firestore fallback). Sent to Roadie as
  // `idempotency_key` so a duplicate dispatch returns 409 instead of booking a
  // second courier. Falls back to requestId when absent. See #113.
  idempotencyKey?: string;
}

export interface CourierDispatchProvider {
  dispatchPickup(input: CourierDispatchInput): Promise<CourierDispatchResult>;
}
