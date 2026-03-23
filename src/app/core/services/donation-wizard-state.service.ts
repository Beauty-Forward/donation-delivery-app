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
  borough: string;
  zip: string;
}

export interface DonationWizardState {
  step: number;
  consent: boolean;
  deliveryMethod: DeliveryMethod | null;
  form: WizardFormState;
  donationAmount: number;
  customAmount: string;
  selectedDate: string | null;
  selectedTime: string | null;
  submitted: boolean;
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
  borough: '',
  zip: ''
};

export const DEFAULT_DONATION_WIZARD_STATE: DonationWizardState = {
  step: 0,
  consent: false,
  deliveryMethod: null,
  form: { ...DEFAULT_WIZARD_FORM_STATE },
  donationAmount: 25,
  customAmount: '',
  selectedDate: null,
  selectedTime: null,
  submitted: false
};

@Injectable({
  providedIn: 'root'
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
          ...(parsed.form ?? {})
        }
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
      form: { ...DEFAULT_WIZARD_FORM_STATE }
    };
  }
}
