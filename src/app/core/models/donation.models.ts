export type DonationType = 'pickup' | 'shipping' | 'dropoff';

export type DonationStatus =
  | 'submitted'
  | 'verifying_payment'
  | 'awaiting_payment'
  | 'payment_verification_failed'
  | 'queued_for_dispatch'
  | 'dispatch_requested'
  | 'awaiting_shipment'
  | 'dropoff_requested'
  | 'completed';

export type ContributionStatus = 'not_started' | 'checkout_started' | 'completed' | 'skipped';

export interface DonorInfo {
  fullName: string;
  email: string;
  phone: string;
  // Future-proofing: this can be associated once auth/accounts are added.
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

export interface WarehouseDestination {
  name: string;
  address: AddressInfo;
  deliveryNotes?: string;
}

export interface ContributionIntent {
  provider: 'givebutter';
  status: ContributionStatus;
  amountUsd?: number;
  checkoutUrl?: string;
  // Captured from the Givebutter widget's donation.complete event; the server uses this
  // to reconcile the webhook payload back to this donation_request.
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
  referenceCode?: string;
}

export interface PickupFlowDraft {
  donor: DonorInfo;
  pickupAddress: AddressInfo;
  preferredDate: string;
  preferredTimeWindow: string;
  courierNotes?: string;
  contributionAmountUsd?: number;
  contributionCheckoutStarted?: boolean;
  contributionCheckoutUrl?: string;
}

export interface DropoffFlowDraft {
  donor: DonorInfo;
  preferredDate: string;
  preferredTimeWindow: string;
  dropoffNotes?: string;
  contributionAmountUsd?: number;
  contributionCheckoutStarted?: boolean;
  contributionCheckoutUrl?: string;
}

export interface CreateDonationRequestPayload {
  donationType: DonationType;
  donor: DonorInfo;
  contribution: ContributionIntent;
  pickup?: PickupDetails;
  shipping?: ShippingDetails;
  dropoff?: DropoffDetails;
  metadata?: Record<string, unknown>;
  // Stable per donation attempt. Sent to the callable and reused in the
  // direct-Firestore fallback so both dispatch attempts share one Roadie
  // idempotency_key — preventing a duplicate courier booking. See #113.
  idempotencyKey?: string;
}

export interface DonationSubmissionResult {
  requestId: string;
  donationType: DonationType;
  status: DonationStatus;
  createdAt: string;
  nextSteps: string[];
  dropoffReference?: string;
  courierDispatchId?: string;
  verifiedAmountUsd?: number;
  failureReason?: string;
}

export interface DonationRequestDocument extends CreateDonationRequestPayload {
  status: DonationStatus;
  createdAt: string;
  updatedAt: string;
  warehouse: WarehouseDestination;
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
