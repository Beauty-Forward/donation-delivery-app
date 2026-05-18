import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PICKUP_TIME_WINDOWS } from '../../core/constants/time-windows';
import { PickupFlowDraft } from '../../core/models/donation.models';
import { DonationFlowStateService } from '../../core/services/donation-flow-state.service';
import { WarehouseConfigService } from '../../core/services/warehouse-config.service';

@Component({
  selector: 'app-pickup-details-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './pickup-details-page.component.html',
  styleUrl: './pickup-details-page.component.scss'
})
export class PickupDetailsPageComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly state = inject(DonationFlowStateService);
  private readonly warehouseConfig = inject(WarehouseConfigService);

  protected readonly timeWindows = PICKUP_TIME_WINDOWS;
  protected readonly minDate = new Date().toISOString().split('T')[0] ?? '';
  protected readonly warehouse = this.warehouseConfig.destination;

  protected readonly form = this.formBuilder.nonNullable.group({
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.required, Validators.minLength(10)]],
    addressLine1: ['', [Validators.required, Validators.minLength(4)]],
    addressLine2: [''],
    city: ['', [Validators.required]],
    state: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(2)]],
    postalCode: ['', [Validators.required, Validators.pattern(/^\d{5}(-\d{4})?$/)]],
    instructions: [''],
    preferredDate: ['', [Validators.required]],
    preferredTimeWindow: ['', [Validators.required]],
    courierNotes: [''],
    contributionAmount: ['']
  });

  constructor() {
    const draft = this.state.getPickupDraft();
    if (draft) {
      this.form.patchValue({
        fullName: draft.donor.fullName,
        email: draft.donor.email,
        phone: draft.donor.phone,
        addressLine1: draft.pickupAddress.line1,
        addressLine2: draft.pickupAddress.line2 ?? '',
        city: draft.pickupAddress.city,
        state: draft.pickupAddress.state,
        postalCode: draft.pickupAddress.postalCode,
        instructions: draft.pickupAddress.instructions ?? '',
        preferredDate: draft.preferredDate,
        preferredTimeWindow: draft.preferredTimeWindow,
        courierNotes: draft.courierNotes ?? '',
        contributionAmount: draft.contributionAmountUsd?.toString() ?? ''
      });
    }
  }

  protected async continueToReview(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const draft: PickupFlowDraft = {
      donor: {
        fullName: value.fullName,
        email: value.email,
        phone: value.phone
      },
      pickupAddress: {
        line1: value.addressLine1,
        line2: value.addressLine2,
        city: value.city,
        state: value.state.toUpperCase(),
        postalCode: value.postalCode,
        instructions: value.instructions
      },
      preferredDate: value.preferredDate,
      preferredTimeWindow: value.preferredTimeWindow,
      courierNotes: value.courierNotes,
      contributionAmountUsd: this.parseAmount(value.contributionAmount)
    };

    this.state.setPickupDraft(draft);
    await this.router.navigate(['/pickup/review']);
  }

  protected hasError(controlName: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[controlName];
    return control.invalid && (control.dirty || control.touched);
  }

  private parseAmount(raw: string): number | undefined {
    if (!raw) {
      return undefined;
    }

    const amount = Number(raw);
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : undefined;
  }
}
