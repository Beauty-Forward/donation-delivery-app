export type DonationType = 'pickup' | 'shipping' | 'dropoff';

export type DonationStatus =
  | 'submitted'
  | 'verifying_payment'
  | 'awaiting_payment'
  | 'payment_verification_failed'
  | 'queued_for_dispatch'
  | 'dispatch_requested'
  | 'pending_label_purchase'
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
  donationNotes?: string;
  warehouseAddress: AddressInfo;
}

export interface ShippingDetails {
  senderAddress: AddressInfo;
  shippingLabelRequested: boolean;
  packageNotes?: string;
  shippingLabelIntentAmountUsd?: number;
  shippingLabelQuoteId?: string;
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
  donationNotes?: string;
  contributionAmountUsd?: number;
  contributionCheckoutStarted?: boolean;
  contributionCheckoutUrl?: string;
}

export interface ShippingFlowDraft {
  donor: DonorInfo;
  senderAddress: AddressInfo;
  shippingLabelRequested: boolean;
  packageNotes?: string;
  contributionAmountUsd?: number;
  shippingLabelCheckoutPrepared?: boolean;
  shippingLabelQuoteId?: string;
  shippingLabelCheckoutUrl?: string;
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
}

export interface DonationSubmissionResult {
  requestId: string;
  donationType: DonationType;
  status: DonationStatus;
  createdAt: string;
  nextSteps: string[];
  dropoffReference?: string;
  courierDispatchId?: string;
  shippingLabelReference?: string;
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

export interface ShippingLabelIntentResult {
  provider: 'mock' | 'future_shipping_provider';
  quoteId: string;
  status: 'pending_checkout' | 'ready';
  checkoutUrl?: string;
}
