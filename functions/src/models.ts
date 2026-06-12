export type DonationType = 'pickup' | 'shipping' | 'dropoff';

export type DonationStatus =
  // Pre-payment draft states, written by saveDonationDraft as the donor moves
  // through the wizard (before they reach the Givebutter widget). 'draft' is a
  // captured lead with partial info; 'pending_payment' is a complete pickup
  // awaiting a Givebutter payment. The reconciliation sweep (see #138) matches a
  // payment to a 'pending_payment' doc and promotes it to queued_for_dispatch.
  // Neither is a terminal state. See #138.
  | 'draft'
  | 'pending_payment'
  | 'submitted'
  | 'verifying_payment'
  | 'awaiting_payment'
  | 'payment_verification_failed'
  | 'queued_for_dispatch'
  | 'dispatch_requested'
  // Pickup-courier lifecycle, advanced by the Roadie inbound webhook
  // (handleRoadieWebhook). queued_for_dispatch → dispatch_requested (driver
  // assigned) → in_transit (en route) → delivered (terminal success).
  // delivery_failed is the terminal unhappy path (canceled / returned /
  // attempt failed). See #106, #107.
  | 'in_transit'
  | 'delivered'
  | 'delivery_failed'
  | 'awaiting_shipment'
  | 'dropoff_requested'
  | 'completed';

export interface DonorInfo {
  fullName: string;
  email: string;
  phone: string;
  donorAccountId?: string;
}

export interface AddressInfo {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  instructions?: string;
}

export interface ContributionIntent {
  provider: 'givebutter';
  status: 'not_started' | 'checkout_started' | 'completed' | 'skipped';
  amountUsd?: number;
  checkoutUrl?: string;
  // Set client-side from the Givebutter widget's donation.complete event; used by the
  // webhook handler to reconcile a payment back to this donation_request.
  gbSessionId?: string;
}

export interface PickupDetails {
  pickupAddress: AddressInfo;
  preferredDate: string;
  preferredTimeWindow: string;
  courierNotes?: string;
  warehouseAddress: AddressInfo;
}

export interface ShippingDetails {
  senderAddress: AddressInfo;
  packageNotes?: string;
}

export interface DropoffDetails {
  preferredDate: string;
  preferredTimeWindow: string;
  dropoffNotes?: string;
  locationName: string;
  locationAddress: AddressInfo;
}

export interface CreateDonationRequestPayload {
  donationType: DonationType;
  donor: DonorInfo;
  contribution: ContributionIntent;
  pickup?: PickupDetails;
  shipping?: ShippingDetails;
  dropoff?: DropoffDetails;
  metadata?: Record<string, unknown>;
  // Client-generated, stable per donation attempt. Shared by the callable and
  // the direct-Firestore fallback; forwarded to Roadie as idempotency_key to
  // prevent a duplicate courier booking. See #113.
  idempotencyKey?: string;
}

export interface DonationSubmissionResult {
  requestId: string;
  donationType: DonationType;
  status: DonationStatus;
  createdAt: string;
  nextSteps: string[];
  courierDispatchId?: string;
  verifiedAmountUsd?: number;
  failureReason?: string;
}

export interface CreateContributionSessionPayload {
  donationType: DonationType;
  amountUsd?: number;
  donorEmail?: string;
  requestId?: string;
}

export interface ContributionSessionResponse {
  provider: 'givebutter';
  sessionId: string;
  checkoutUrl: string;
}

export interface CourierDispatchResult {
  provider: 'roadie' | 'mock-roadie';
  dispatchId: string;
  status: 'queued' | 'assigned';
  etaWindow: string;
}
