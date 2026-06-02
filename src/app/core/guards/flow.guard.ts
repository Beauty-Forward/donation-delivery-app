import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { DonationFlowStateService } from '../services/donation-flow-state.service';

export const pickupDraftGuard: CanActivateFn = () => {
  const state = inject(DonationFlowStateService);
  const router = inject(Router);
  return state.getPickupDraft() ? true : router.createUrlTree(['/pickup']);
};

export const pickupConfirmationGuard: CanActivateFn = () => {
  const state = inject(DonationFlowStateService);
  const router = inject(Router);
  return state.getPickupConfirmation() ? true : router.createUrlTree(['/pickup']);
};

export const dropoffDraftGuard: CanActivateFn = () => {
  const state = inject(DonationFlowStateService);
  const router = inject(Router);
  return state.getDropoffDraft() ? true : router.createUrlTree(['/dropoff']);
};

export const dropoffConfirmationGuard: CanActivateFn = () => {
  const state = inject(DonationFlowStateService);
  const router = inject(Router);
  return state.getDropoffConfirmation() ? true : router.createUrlTree(['/dropoff']);
};
