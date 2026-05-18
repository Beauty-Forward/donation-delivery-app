import { Injectable } from '@angular/core';

export type DeliveryMethod = 'courier' | 'dropoff' | 'ship';

export interface WizardFormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  packageSize: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  courierNotes: string;
  dropoffNotes: string;
}

export type ConfirmationView = 'verifying' | 'success' | 'failed';

// When confirmationView is 'failed', failureReason explains *why* so the wizard
// can show truthful copy. 'awaiting_payment' means we can't yet confirm whether
// the donor paid (Givebutter API error, or Roadie dispatch failed after payment
// was verified) — critically, in this state we must NOT prompt the donor to pay
// again, because they may have already paid.
export type WizardFailureReason =
  | 'awaiting_payment'
  | 'payment_verification_failed'
  | 'unknown';

export interface DonationWizardState {
  step: number;
  consentProducts: boolean;
  consentLiability: boolean;
  deliveryMethod: DeliveryMethod | null;
  form: WizardFormState;
  gbSessionId: string | null;
  gbAmountUsd: number | null;
  selectedDate: string | null;
  selectedTime: string | null;
  submitted: boolean;
  submittedRequestId: string | null;
  confirmationView: ConfirmationView;
  failureReason: WizardFailureReason;
  verifiedAmountUsd: number | null;
}

export const DEFAULT_WIZARD_FORM_STATE: WizardFormState = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  packageSize: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  zip: '',
  courierNotes: '',
  dropoffNotes: '',
};

export const DEFAULT_DONATION_WIZARD_STATE: DonationWizardState = {
  step: 0,
  consentProducts: false,
  consentLiability: false,
  deliveryMethod: null,
  form: { ...DEFAULT_WIZARD_FORM_STATE },
  gbSessionId: null,
  gbAmountUsd: null,
  selectedDate: null,
  selectedTime: null,
  submitted: false,
  submittedRequestId: null,
  confirmationView: 'verifying',
  failureReason: 'unknown',
  verifiedAmountUsd: null,
};

@Injectable({
  providedIn: 'root',
})
export class DonationWizardStateService {
  private readonly storageKey = 'beauty-forward.donationWizard';

  get(): DonationWizardState {
    if (typeof sessionStorage === 'undefined') {
      return this.cloneDefault();
    }

    const raw = sessionStorage.getItem(this.storageKey);
    if (!raw) {
      return this.cloneDefault();
    }

    try {
      const parsed = JSON.parse(raw) as Partial<DonationWizardState>;
      return {
        ...this.cloneDefault(),
        ...parsed,
        form: {
          ...DEFAULT_WIZARD_FORM_STATE,
          ...(parsed.form ?? {}),
        },
      };
    } catch {
      return this.cloneDefault();
    }
  }

  set(state: DonationWizardState): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }

    sessionStorage.setItem(this.storageKey, JSON.stringify(state));
  }

  clear(): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }

    sessionStorage.removeItem(this.storageKey);
  }

  private cloneDefault(): DonationWizardState {
    return {
      ...DEFAULT_DONATION_WIZARD_STATE,
      form: { ...DEFAULT_WIZARD_FORM_STATE },
    };
  }
}
