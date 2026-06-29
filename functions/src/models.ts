export type DonationType = 'pickup' | 'shipping' | 'dropoff';

export type DonationStatus =
  // Pickup. createDonationRequest lands the doc in verifying_payment; the Givebutter
  // webhook moves it to queued_for_dispatch on success, or dispatch_failed if payment
  // confirmed but the Roadie booking threw (sendStalledDonationSlaEmails recovers it).
  // A doc stuck in verifying_payment past 24h = abandoned (sendStalledRecoveryEmails).
  | 'verifying_payment'
  | 'queued_for_dispatch'
  | 'dispatch_failed'
  // Shipping / dropoff — no payment gate, terminal at create.
  | 'awaiting_shipment'
  | 'dropoff_requested';

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

export interface CourierDispatchInput {
  requestId: string;
  donor: DonorInfo;
  pickup: PickupDetails;
}

export interface RoadieItemDescription {
  description: 'Beauty product donation';
  quantity: number;
  length: number;
  width: number;
  height: number;
  weight: number;
}

export interface RoadieAddress {
  street1: string;
  street2: string | undefined;
  city: string;
  state: string;
  zip: string;
}

export interface RoadieLocation {
  address: RoadieAddress;
  notes: string;
  contact: {
    name: string;
    phone: string;
  };
}

export interface RoadieShipmentPayload {
  reference_id: string;
  idempotency_key: string;
  description: 'Beauty Forward donation pickup';
  items: RoadieItemDescription[];
  pickup_location: RoadieLocation;
  delivery_location: RoadieLocation;
  pickup_after: string;
  deliver_between: {
    start: string;
    end: string;
  };
  time_zone: 'America/New_York';
  options: {
    signature_required: false;
    notifications_enabled: true;
    over_21_required: false;
    decline_insurance: true;
  };
}
