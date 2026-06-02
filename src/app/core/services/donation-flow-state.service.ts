import { Injectable, signal } from '@angular/core';
import {
  DonationSubmissionResult,
  DropoffFlowDraft,
  PickupFlowDraft
} from '../models/donation.models';

@Injectable({
  providedIn: 'root'
})
export class DonationFlowStateService {
  private readonly pickupDraftState = signal<PickupFlowDraft | null>(this.read<PickupFlowDraft>('pickupDraft'));
  private readonly dropoffDraftState = signal<DropoffFlowDraft | null>(
    this.read<DropoffFlowDraft>('dropoffDraft')
  );

  private readonly pickupConfirmationState = signal<DonationSubmissionResult | null>(
    this.read<DonationSubmissionResult>('pickupConfirmation')
  );
  private readonly dropoffConfirmationState = signal<DonationSubmissionResult | null>(
    this.read<DonationSubmissionResult>('dropoffConfirmation')
  );

  getPickupDraft(): PickupFlowDraft | null {
    return this.pickupDraftState();
  }

  setPickupDraft(draft: PickupFlowDraft): void {
    this.pickupDraftState.set(draft);
    this.write('pickupDraft', draft);
  }

  clearPickupDraft(): void {
    this.pickupDraftState.set(null);
    this.remove('pickupDraft');
  }

  getDropoffDraft(): DropoffFlowDraft | null {
    return this.dropoffDraftState();
  }

  setDropoffDraft(draft: DropoffFlowDraft): void {
    this.dropoffDraftState.set(draft);
    this.write('dropoffDraft', draft);
  }

  clearDropoffDraft(): void {
    this.dropoffDraftState.set(null);
    this.remove('dropoffDraft');
  }

  getPickupConfirmation(): DonationSubmissionResult | null {
    return this.pickupConfirmationState();
  }

  setPickupConfirmation(result: DonationSubmissionResult): void {
    this.pickupConfirmationState.set(result);
    this.write('pickupConfirmation', result);
  }

  getDropoffConfirmation(): DonationSubmissionResult | null {
    return this.dropoffConfirmationState();
  }

  setDropoffConfirmation(result: DonationSubmissionResult): void {
    this.dropoffConfirmationState.set(result);
    this.write('dropoffConfirmation', result);
  }

  private read<T>(key: string): T | null {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }

    const raw = sessionStorage.getItem(this.storageKey(key));
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }

    sessionStorage.setItem(this.storageKey(key), JSON.stringify(value));
  }

  private remove(key: string): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }

    sessionStorage.removeItem(this.storageKey(key));
  }

  private storageKey(key: string): string {
    return `beauty-forward.${key}`;
  }
}
