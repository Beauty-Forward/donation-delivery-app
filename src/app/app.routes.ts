import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/wizard/donation-wizard-page.component').then(
        (m) => m.DonationWizardPageComponent
      ),
    data: { mode: 'home' }
  },
  {
    path: 'pickup',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/wizard/donation-wizard-page.component').then(
            (m) => m.DonationWizardPageComponent
          ),
        data: { mode: 'pickup' }
      },
      {
        path: 'review',
        loadComponent: () =>
          import('./features/wizard/donation-wizard-page.component').then(
            (m) => m.DonationWizardPageComponent
          ),
        data: { mode: 'pickup-review' }
      },
      {
        path: 'confirmation',
        loadComponent: () =>
          import('./features/wizard/donation-wizard-page.component').then(
            (m) => m.DonationWizardPageComponent
          ),
        data: { mode: 'pickup-confirmation' }
      }
    ]
  },
  {
    path: 'shipping',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/wizard/donation-wizard-page.component').then(
            (m) => m.DonationWizardPageComponent
          ),
        data: { mode: 'shipping' }
      },
      {
        path: 'review',
        loadComponent: () =>
          import('./features/wizard/donation-wizard-page.component').then(
            (m) => m.DonationWizardPageComponent
          ),
        data: { mode: 'shipping-review' }
      },
      {
        path: 'confirmation',
        loadComponent: () =>
          import('./features/wizard/donation-wizard-page.component').then(
            (m) => m.DonationWizardPageComponent
          ),
        data: { mode: 'shipping-confirmation' }
      }
    ]
  },
  {
    path: 'dropoff',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/wizard/donation-wizard-page.component').then(
            (m) => m.DonationWizardPageComponent
          ),
        data: { mode: 'dropoff' }
      },
      {
        path: 'review',
        loadComponent: () =>
          import('./features/wizard/donation-wizard-page.component').then(
            (m) => m.DonationWizardPageComponent
          ),
        data: { mode: 'dropoff-review' }
      },
      {
        path: 'confirmation',
        loadComponent: () =>
          import('./features/wizard/donation-wizard-page.component').then(
            (m) => m.DonationWizardPageComponent
          ),
        data: { mode: 'dropoff-confirmation' }
      }
    ]
  },
  {
    path: '**',
    redirectTo: ''
  }
];
