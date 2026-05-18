import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  CreateDonationRequestPayload,
  PickupFlowDraft
} from '../../core/models/donation.models';
import { ContributionService } from '../../core/services/contribution.service';
import { DonationApiService } from '../../core/services/donation-api.service';
import { DonationFlowStateService } from '../../core/services/donation-flow-state.service';
import { WarehouseConfigService } from '../../core/services/warehouse-config.service';
import { ContributionPanelComponent } from '../../shared/components/contribution-panel/contribution-panel.component';

@Component({
  selector: 'app-pickup-review-page',
  imports: [RouterLink, ContributionPanelComponent],
  templateUrl: './pickup-review-page.component.html',
  styleUrl: './pickup-review-page.component.scss'
})
export class PickupReviewPageComponent {
  private readonly router = inject(Router);
  private readonly state = inject(DonationFlowStateService);
  private readonly donationApi = inject(DonationApiService);
  private readonly contributionService = inject(ContributionService);
  private readonly warehouseConfig = inject(WarehouseConfigService);

  protected readonly warehouse = this.warehouseConfig.destination;

  protected draft: PickupFlowDraft | null = null;
  protected isSubmitting = false;
  protected submitError = '';
  protected isStartingContribution = false;
  protected contributionError = '';

  constructor() {
    this.draft = this.state.getPickupDraft();
  }

  protected updateContributionAmount(amount?: number): void {
    if (!this.draft) {
      return;
    }

    this.draft = {
      ...this.draft,
      contributionAmountUsd: amount
    };
    this.state.setPickupDraft(this.draft);
  }

  protected async launchContribution(amount?: number): Promise<void> {
    if (!this.draft) {
      return;
    }

    this.isStartingContribution = true;
    this.contributionError = '';

    try {
      const checkoutUrl = await this.contributionService.launchGivebutterCheckout(
        'pickup',
        this.draft.donor.email,
        amount ?? this.draft.contributionAmountUsd
      );

      this.draft = {
        ...this.draft,
        contributionAmountUsd: amount ?? this.draft.contributionAmountUsd,
        contributionCheckoutStarted: true,
        contributionCheckoutUrl: checkoutUrl
      };
      this.state.setPickupDraft(this.draft);
    } catch {
      this.contributionError =
        'We could not open contribution checkout right now. You can still submit your pickup request.';
    } finally {
      this.isStartingContribution = false;
    }
  }

  protected async submitRequest(): Promise<void> {
    if (!this.draft || this.isSubmitting) {
      return;
    }

    this.isSubmitting = true;
    this.submitError = '';

    const payload: CreateDonationRequestPayload = {
      donationType: 'pickup',
      donor: this.draft.donor,
      contribution: {
        provider: 'givebutter',
        status: this.draft.contributionCheckoutStarted ? 'checkout_started' : 'not_started',
        amountUsd: this.draft.contributionAmountUsd,
        checkoutUrl: this.draft.contributionCheckoutUrl
      },
      pickup: {
        pickupAddress: this.draft.pickupAddress,
        preferredDate: this.draft.preferredDate,
        preferredTimeWindow: this.draft.preferredTimeWindow,
        courierNotes: this.draft.courierNotes,
        warehouseAddress: this.warehouse.address
      },
      metadata: {
        flowVersion: 'mvp-v1',
        channel: 'public-web',
        courierProvider: 'roadie-ready-mock'
      }
    };

    try {
      const result = await this.donationApi.createDonationRequest(payload);
      this.state.setPickupConfirmation(result);
      this.state.clearPickupDraft();
      await this.router.navigate(['/pickup/confirmation']);
    } catch {
      this.submitError = 'Something went wrong while submitting. Please try again.';
    } finally {
      this.isSubmitting = false;
    }
  }
}
