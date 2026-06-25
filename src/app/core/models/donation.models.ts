export type DonationType = 'pickup' | 'shipping' | 'dropoff';

export type DonationStatus =
  | 'submitted'
  | 'verifying_payment'
  | 'payment_not_found'
  | 'payment_verification_failed'
  | 'awaiting_dispatch'
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
  courierNotes: string;
  warehouseAddress: AddressInfo;
  warehouseDeliveryInstructions: string;
}

export interface ShippingDetails {
  senderAddress: AddressInfo;
  packageNotes?: string;
}

export interface DropoffDetails {
  locationName: string;
  locationAddress: AddressInfo;
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
  contributionAmountUsd?: number;
  contributionCheckoutStarted?: boolean;
  contributionCheckoutUrl?: string;
}

export interface CreateDonationRequestPayload {
  requestId: string;
  donationType: DonationType;
  donor: DonorInfo;
  contribution: ContributionIntent;
  pickup?: PickupDetails;
  shipping?: ShippingDetails;
  dropoff?: DropoffDetails;
  metadata?: Record<string, unknown>;
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
