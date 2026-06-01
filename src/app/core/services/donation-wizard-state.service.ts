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
// can show truthful copy. The two awaiting_payment variants must NOT prompt the
// donor to pay again, because they may have (or definitely have) already paid:
//   - 'payment_verified_dispatch_failed': Givebutter confirmed payment, but the
//     Roadie courier booking failed. We KNOW they paid — reassure them and tell
//     them we'll confirm the pickup.
//   - 'awaiting_payment': Givebutter's API was unreachable, so we can't yet tell
//     whether they paid. Acknowledge the request and say we're still confirming.
//   - 'payment_verification_failed': Givebutter definitively found no payment.
//     This is a real "we couldn't confirm" — the Try-again CTA is correct here.
// A null failureReason means there is no classified failure: either no failure at
// all (success / fresh state), or the submission never returned a usable result
// from our own backend (the call threw, so we don't even have a status). The null
// catch-all renders the same generic "couldn't confirm" + Try-again pane as
// 'payment_verification_failed'.
export type WizardFailureReason =
  | 'payment_verified_dispatch_failed'
  | 'awaiting_payment'
  | 'payment_verification_failed';

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
  failureReason: WizardFailureReason | null;
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
  failureReason: null,
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
