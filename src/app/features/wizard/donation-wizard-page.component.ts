import { CommonModule } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, startWith } from 'rxjs';
import {
  DEFAULT_WIZARD_FORM_STATE,
  DeliveryMethod,
  DonationWizardState,
  DonationWizardStateService,
  WizardFormState,
} from '../../core/services/donation-wizard-state.service';
import { DonationApiService } from '../../core/services/donation-api.service';
import { WarehouseConfigService } from '../../core/services/warehouse-config.service';
import {
  AddressInfo,
  CreateDonationRequestPayload,
  DonationType,
} from '../../core/models/donation.models';
import { environment } from '../../../environments/environment';

type RouteMode =
  | 'home'
  | 'pickup'
  | 'pickup-review'
  | 'pickup-confirmation'
  | 'shipping'
  | 'shipping-review'
  | 'shipping-confirmation'
  | 'dropoff'
  | 'dropoff-review'
  | 'dropoff-confirmation';

interface PackageOption {
  id: string;
  label: string;
  description: string;
}

interface MethodOption {
  id: DeliveryMethod;
  title: string;
  description: string;
  tag?: string;
}

interface PickupDateOption {
  iso: string;
  day: string;
  month: string;
  date: number;
}

interface StepLineItem {
  number: string;
  text: string;
}

interface SummarySection {
  label: string;
  lines: string[];
}

interface ConfirmationRow {
  label: string;
  value: string;
}

@Component({
  selector: 'app-donation-wizard-page',
  imports: [CommonModule, FormsModule],
  templateUrl: './donation-wizard-page.component.html',
  styleUrl: './donation-wizard-page.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class DonationWizardPageComponent {
  @ViewChild('containerRef') private containerRef?: ElementRef<HTMLDivElement>;

  private readonly router = inject(Router);
  private readonly stateStore = inject(DonationWizardStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly donationApi = inject(DonationApiService);
  private readonly warehouseConfig = inject(WarehouseConfigService);

  protected readonly boroughs = ['Manhattan', 'Brooklyn', 'Queens', 'The Bronx', 'Staten Island'];
  protected readonly packageSizes: PackageOption[] = [
    { id: 'small', label: 'Small', description: 'Fits in a shoebox' },
    { id: 'medium', label: 'Medium', description: 'Fits in the front seat of a car' },
    { id: 'large', label: 'Large', description: 'Fits in the back seat of a car' },
  ];
  protected readonly donationPresets = [5, 15, 25, 50];
  protected readonly pickupTimes = [
    '9:00 AM - 11:00 AM',
    '11:00 AM - 1:00 PM',
    '1:00 PM - 3:00 PM',
    '3:00 PM - 5:00 PM',
  ];
  protected readonly eligibleItems = [
    'Unopened skincare products',
    'Sealed hair care products',
    'New and unopened beauty tools',
    'Unopened makeup & cosmetics',
    'Sealed hygiene essentials',
    'New nail care products',
    'Unused feminine hygiene products',
  ];
  protected readonly welcomeSteps = [
    'Tell us what you are donating',
    'Choose how to get it to us',
    'Products reach underserved communities',
  ];
  protected readonly methodOptions: MethodOption[] = [
    {
      id: 'courier',
      title: 'Courier Pickup',
      description: 'We send a courier to collect from your door. A small donation covers the cost.',
      tag: 'Most popular',
    },
    {
      id: 'dropoff',
      title: 'Drop Off',
      description: 'Bring your donation to our Brooklyn warehouse during business hours. Free.',
    },
    {
      id: 'ship',
      title: 'Ship to Us',
      description: 'Mail your package to our warehouse at your own cost using any carrier.',
    },
  ];
  protected readonly dropoffArrivalSteps: StepLineItem[] = [
    { number: '01', text: 'Head to the drop-off desk inside the warehouse entrance' },
    { number: '02', text: "You'll be given a QR code label to attach to your package" },
    { number: '03', text: 'Scan the QR code at the desk and fill in your details' },
    { number: '04', text: "Leave your package with our team - that's it!" },
  ];
  protected readonly shippingHowItWorksSteps: StepLineItem[] = [
    { number: '01', text: 'Pack your beauty products securely in a box or padded mailer' },
    { number: '02', text: 'Ship via USPS, UPS, FedEx, or any carrier of your choice' },
    { number: '03', text: 'Include your name and email inside the package for your receipt' },
    { number: '04', text: "We'll email you a confirmation once we receive your package" },
  ];

  protected readonly warehouse = {
    name: environment.warehouse.name,
    line1: environment.warehouse.line1,
    line2: environment.warehouse.line2,
    city: environment.warehouse.city,
    state: environment.warehouse.state,
    zip: environment.warehouse.postalCode,
    hours: environment.warehouse.hours,
  };

  protected readonly pickupDateOptions = this.buildPickupDateOptions();

  protected step = 0;
  protected consentProducts = false;
  protected consentLiability = false;
  protected deliveryMethod: DeliveryMethod | null = null;
  protected form: WizardFormState = { ...DEFAULT_WIZARD_FORM_STATE };
  protected donationAmount = 25;
  protected customAmount = '';
  protected selectedDate: string | null = null;
  protected selectedTime: string | null = null;
  protected submitted = false;
  protected fadeIn = true;
  protected errors: Record<string, string> = {};

  constructor() {
    this.applyState(this.stateStore.get());
  }

  ngOnInit(): void {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        startWith(new NavigationEnd(0, this.router.url, this.router.url)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        const mode = this.resolveModeFromUrl(this.router.url);
        this.syncToMode(mode);
        this.persist();
      });
  }

  protected get totalSteps(): number {
    return this.deliveryMethod === 'courier' ? 7 : 6;
  }

  protected get displayStep(): number {
    if (this.step <= 2) {
      return this.step;
    }

    if (this.deliveryMethod === 'courier') {
      if (this.step === 3) return 3;
      if (this.step === 4) return 4;
      if (this.step === 5) return 5;
      if (this.step === 6) return 6;
    } else {
      if (this.step === 3) return 3;
      if (this.step === 7 || this.step === 8) return 4;
      if (this.step === 6) return 5;
    }

    return this.step;
  }

  protected get selectedPackageLabel(): string {
    return this.packageSizes.find((item) => item.id === this.form.packageSize)?.label ?? '';
  }

  protected get progressSegments(): number[] {
    return Array.from({ length: this.totalSteps }, (_, index) => index);
  }

  protected get finalDonationAmount(): number {
    const custom = Number(this.customAmount);
    if (Number.isFinite(custom) && custom > 0) {
      return custom;
    }

    return this.donationAmount;
  }

  protected get pickupDateLabel(): string {
    if (!this.selectedDate) {
      return '';
    }

    return new Date(`${this.selectedDate}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }

  protected get methodLabel(): string {
    if (this.deliveryMethod === 'courier') {
      return 'Courier Pickup';
    }
    if (this.deliveryMethod === 'dropoff') {
      return 'Drop Off';
    }
    return 'Self-Ship';
  }

  protected get reviewSections(): SummarySection[] {
    const sections: SummarySection[] = [
      {
        label: 'Contact',
        lines: [
          `${this.form.firstName} ${this.form.lastName}`.trim(),
          this.form.email,
          this.form.phone,
        ].filter(Boolean),
      },
      {
        label: 'Package',
        lines: [this.selectedPackageLabel || 'Not selected'],
      },
      {
        label: 'Method',
        lines: [this.methodLabel],
      },
    ];

    if (this.deliveryMethod === 'courier') {
      sections.push(
        {
          label: 'Pickup',
          lines: [
            `${this.form.addressLine1}${this.form.addressLine2 ? `, ${this.form.addressLine2}` : ''}`,
            `${this.form.borough}, NY ${this.form.zip}`,
          ],
        },
        {
          label: 'Schedule',
          lines: [`${this.pickupDateLabel}`, `${this.selectedTime}`],
        },
        {
          label: 'Notes for the courier',
          lines: [this.form.courierNotes],
        },
        {
          label: 'Donation',
          lines: [`$${this.finalDonationAmount}`],
        },
      );
    }

    if (this.deliveryMethod === 'dropoff') {
      sections.push({
        label: this.warehouse.name,
        lines: [
          this.warehouse.line1,
          this.warehouse.line2,
          `${this.warehouse.city}, ${this.warehouse.state} ${this.warehouse.zip}`,
          this.warehouse.hours,
        ],
      });
    }

    if (this.deliveryMethod === 'ship') {
      sections.push({
        label: 'Ship to',
        lines: [
          this.warehouse.name,
          `${this.warehouse.line1} ${this.warehouse.line2}`,
          `${this.warehouse.city}, ${this.warehouse.state} ${this.warehouse.zip}`,
        ],
      });
    }

    return sections;
  }

  protected get confirmationRows(): ConfirmationRow[] {
    const rows: ConfirmationRow[] = [
      {
        label: 'Contact',
        value: `${this.form.firstName} ${this.form.lastName}`.trim(),
      },
      {
        label: 'Package',
        value: this.selectedPackageLabel || 'Not selected',
      },
      {
        label: 'Method',
        value: this.methodLabel,
      },
    ];

    if (this.deliveryMethod === 'courier') {
      rows.push(
        {
          label: 'When',
          value: `${this.pickupDateLabel}, ${this.selectedTime}`,
        },
        {
          label: 'Address',
          value: `${this.form.addressLine1}, ${this.form.borough}`,
        },
        {
          label: 'Donation',
          value: `$${this.finalDonationAmount}`,
        },
      );
    }

    if (this.deliveryMethod === 'dropoff') {
      rows.push({
        label: this.warehouse.name,
        value: `${this.warehouse.line1} ${this.warehouse.line2} ${this.warehouse.city} ${this.warehouse.state}, ${this.warehouse.zip}`,
      });
    }

    if (this.deliveryMethod === 'ship') {
      rows.push({
        label: 'Ship to',
        value: `${this.warehouse.line1} ${this.warehouse.line2} ${this.warehouse.city} ${this.warehouse.state}, ${this.warehouse.zip}`,
      });
    }

    return rows;
  }

  protected updateField(field: keyof WizardFormState, value: string): void {
    this.form = {
      ...this.form,
      [field]: value,
    };

    this.clearError(field);
    this.persist();
  }

  protected setPackageSize(sizeId: string): void {
    this.updateField('packageSize', sizeId);
  }

  protected setMethod(method: DeliveryMethod): void {
    this.deliveryMethod = method;
    this.clearError('deliveryMethod');
    this.persist();
  }

  protected toggleConsentProducts(): void {
    this.consentProducts = !this.consentProducts;
    this.persist();
  }

  protected toggleConsentLiability(): void {
    this.consentLiability = !this.consentLiability;
    this.persist();
  }

  protected setDonationPreset(amount: number): void {
    this.donationAmount = amount;
    this.customAmount = '';
    this.clearError('donation');
    this.persist();
  }

  protected setCustomAmount(raw: string): void {
    this.customAmount = raw;
    this.donationAmount = 0;
    this.clearError('donation');
    this.persist();
  }

  protected selectDate(iso: string): void {
    this.selectedDate = iso;
    this.clearError('date');
    this.persist();
  }

  protected selectTime(time: string): void {
    this.selectedTime = time;
    this.clearError('time');
    this.persist();
  }

  protected startDonation(): void {
    this.transitionLocal(1);
  }

  protected continueFromGuidelines(): void {
    if (!this.consentProducts || !this.consentLiability) {
      return;
    }

    this.transitionLocal(2);
  }

  protected continueFromMethod(): void {
    if (!this.deliveryMethod) {
      return;
    }

    this.transitionLocal(3);
  }

  protected continueFromDetails(): void {
    if (!this.validateInfo()) {
      return;
    }

    const next = this.afterDetailsStep;

    if (next === 4) {
      void this.transitionRoute('/pickup', 4, false);
      return;
    }

    if (next === 7) {
      void this.transitionRoute('/dropoff', 7, false);
      return;
    }

    void this.transitionRoute('/shipping', 8, false);
  }

  protected continueFromDonation(): void {
    if (!this.validateDonation()) {
      return;
    }

    this.transitionLocal(6);
  }

  protected continueFromSchedule(): void {
    if (!this.validateSchedule()) {
      return;
    }

    void this.transitionLocal(5);
  }

  protected continueFromDropoffInfo(): void {
    void this.transitionRoute('/dropoff/review', 6, false);
  }

  protected continueFromShippingInfo(): void {
    void this.transitionRoute('/shipping/review', 6, false);
  }

  protected confirmDonation(): void {
    if (!this.deliveryMethod) {
      return;
    }

    // Fire-and-forget: persist the donation_request server-side (which also
    // triggers the HubSpot CRM upsert). Errors are logged but do not block
    // the user from reaching the confirmation screen — the API service
    // already has a Firestore-direct fallback for callable failures.
    void this.persistDonation();

    if (this.deliveryMethod === 'courier') {
      void this.transitionRoute('/pickup/confirmation', 6, true);
      return;
    }

    if (this.deliveryMethod === 'dropoff') {
      void this.transitionRoute('/dropoff/confirmation', 6, true);
      return;
    }

    void this.transitionRoute('/shipping/confirmation', 6, true);
  }

  private async persistDonation(): Promise<void> {
    if (!this.deliveryMethod) {
      return;
    }

    const donationType: DonationType =
      this.deliveryMethod === 'courier'
        ? 'pickup'
        : this.deliveryMethod === 'dropoff'
        ? 'dropoff'
        : 'shipping';

    // The wizard collects firstName + lastName separately; the backend
    // donor schema uses fullName, so reassemble.
    const fullName = `${this.form.firstName} ${this.form.lastName}`.trim();

    // The wizard's borough field is the donor's NYC borough (Brooklyn,
    // Queens, etc.). HubSpot's built-in `city` Contact property is where
    // we land that — see hubspot.service.ts. State is hardcoded to NY
    // because the wizard is NYC-only today.
    const donorCity = this.form.borough || this.form.city;
    const donorState = donorCity ? 'NY' : '';

    const warehouseAddress = this.warehouseConfig.destination.address;

    const payload: CreateDonationRequestPayload = {
      donationType,
      donor: {
        fullName,
        email: this.form.email,
        phone: this.form.phone,
      },
      contribution: {
        provider: 'givebutter',
        // The wizard renders a Givebutter widget for the actual payment;
        // we don't yet capture whether the user completed it. Mark as
        // not_started — the Givebutter webhook will refresh status to
        // completed once payment lands.
        status: 'not_started',
        amountUsd: this.finalDonationAmount,
      },
      metadata: {
        flowVersion: 'wizard-v1',
        channel: 'public-web',
        source: 'donation-wizard',
        packageSize: this.form.packageSize,
        // Pass city/state through metadata so HubSpot picks them up even
        // for dropoff/shipping payloads where the donor address isn't
        // part of the typed payload.
        city: donorCity,
        state: donorState,
      },
    };

    if (donationType === 'pickup') {
      payload.pickup = {
        pickupAddress: this.buildDonorAddress(donorCity, donorState),
        preferredDate: this.selectedDate ?? '',
        preferredTimeWindow: this.selectedTime ?? '',
        donationNotes: this.form.courierNotes || undefined,
        warehouseAddress,
      };
    } else if (donationType === 'dropoff') {
      payload.dropoff = {
        // The wizard doesn't ask dropoff donors to schedule a slot — they
        // walk in during business hours. Mirror the createWalkInDonation
        // pattern: use today's date and a "flexible" window.
        preferredDate: new Date().toISOString().slice(0, 10),
        preferredTimeWindow: 'flexible',
        locationName: this.warehouseConfig.destination.name,
        locationAddress: warehouseAddress,
      };
    } else {
      // Shipping: the wizard doesn't currently collect a return/sender
      // address from ship-mode donors (only courier mode prompts for
      // the address fields). Fall back to whatever address fragments
      // the donor entered earlier in the flow; if none, use a TBD
      // placeholder so the validator passes. donation_request will be
      // imperfect, but HubSpot still receives clean contact data.
      payload.shipping = {
        senderAddress: this.buildDonorAddress(donorCity, donorState),
        shippingLabelRequested: false,
      };
    }

    try {
      await this.donationApi.createDonationRequest(payload);
    } catch (err) {
      console.warn('Failed to persist donation_request from wizard', err);
    }
  }

  private buildDonorAddress(city: string, state: string): AddressInfo {
    return {
      line1: this.form.addressLine1 || 'Not provided',
      line2: this.form.addressLine2 || undefined,
      city: city || 'Not provided',
      state: state || 'NY',
      postalCode: this.form.zip || '00000',
    };
  }

  protected backTo(step: number): void {
    this.transitionLocal(step);
  }

  protected backFromReview(): void {
    if (this.deliveryMethod === 'courier') {
      void this.transitionRoute('/pickup', 5, false);
      return;
    }

    if (this.deliveryMethod === 'dropoff') {
      void this.transitionRoute('/dropoff', 7, false);
      return;
    }

    void this.transitionRoute('/shipping', 8, false);
  }

  protected restartFromHome(): void {
    this.reset();
    void this.router.navigateByUrl('/');
  }

  private get afterDetailsStep(): number {
    if (this.deliveryMethod === 'courier') return 4;
    if (this.deliveryMethod === 'dropoff') return 7;
    return 8;
  }

  private syncToMode(mode: RouteMode): void {
    switch (mode) {
      case 'home':
        this.submitted = false;
        if (this.step > 3) {
          this.step = 0;
          this.deliveryMethod = null;
        }
        break;
      case 'pickup':
        this.deliveryMethod = 'courier';
        this.submitted = false;
        if (this.step !== 4 && this.step !== 5) {
          this.step = 4;
        }
        break;
      case 'pickup-review':
        this.deliveryMethod = 'courier';
        this.step = 6;
        this.submitted = false;
        break;
      case 'pickup-confirmation':
        this.deliveryMethod = 'courier';
        this.step = 6;
        this.submitted = true;
        break;
      case 'dropoff':
        this.deliveryMethod = 'dropoff';
        this.step = 7;
        this.submitted = false;
        break;
      case 'dropoff-review':
        this.deliveryMethod = 'dropoff';
        this.step = 6;
        this.submitted = false;
        break;
      case 'dropoff-confirmation':
        this.deliveryMethod = 'dropoff';
        this.step = 6;
        this.submitted = true;
        break;
      case 'shipping':
        this.deliveryMethod = 'ship';
        this.step = 8;
        this.submitted = false;
        break;
      case 'shipping-review':
        this.deliveryMethod = 'ship';
        this.step = 6;
        this.submitted = false;
        break;
      case 'shipping-confirmation':
        this.deliveryMethod = 'ship';
        this.step = 6;
        this.submitted = true;
        break;
      default:
        break;
    }

    this.errors = {};
  }

  private resolveModeFromUrl(url: string): RouteMode {
    const normalized = url.split('?')[0]?.replace(/\/+$/, '') || '/';

    if (normalized === '/') {
      return 'home';
    }

    if (normalized === '/pickup') return 'pickup';
    if (normalized === '/pickup/review') return 'pickup-review';
    if (normalized === '/pickup/confirmation') return 'pickup-confirmation';

    if (normalized === '/shipping') return 'shipping';
    if (normalized === '/shipping/review') return 'shipping-review';
    if (normalized === '/shipping/confirmation') return 'shipping-confirmation';

    if (normalized === '/dropoff') return 'dropoff';
    if (normalized === '/dropoff/review') return 'dropoff-review';
    if (normalized === '/dropoff/confirmation') return 'dropoff-confirmation';

    return 'home';
  }

  private validateInfo(): boolean {
    const errors: Record<string, string> = {};

    if (!this.form.firstName.trim()) errors['firstName'] = 'Required';
    if (!this.form.lastName.trim()) errors['lastName'] = 'Required';
    if (!this.form.email.trim() || !/\S+@\S+\.\S+/.test(this.form.email)) {
      errors['email'] = 'Valid email required';
    }

    if (!this.form.phone.trim() || this.form.phone.replace(/\D/g, '').length < 10) {
      errors['phone'] = 'Valid phone required';
    }

    if (!this.form.packageSize) {
      errors['packageSize'] = 'Select a size';
    }

    if (this.deliveryMethod === 'courier') {
      if (!this.form.addressLine1.trim()) {
        errors['addressLine1'] = 'Required';
      }

      if (!this.form.borough) {
        errors['borough'] = 'Select a borough';
      }

      if (!this.form.zip.trim() || this.form.zip.replace(/\D/g, '').length < 5) {
        errors['zip'] = 'Valid ZIP required';
      }
    }

    this.errors = errors;
    return Object.keys(errors).length === 0;
  }

  private validateDonation(): boolean {
    const amount = this.finalDonationAmount;
    const errors: Record<string, string> = {};

    if (!amount || Number.isNaN(amount) || amount < 5) {
      errors['donation'] = 'Minimum donation is $5';
    }

    this.errors = errors;
    return Object.keys(errors).length === 0;
  }

  private validateSchedule(): boolean {
    const errors: Record<string, string> = {};

    if (!this.selectedDate) {
      errors['date'] = 'Select a date';
    }

    if (!this.selectedTime) {
      errors['time'] = 'Select a time';
    }

    if (!this.form.courierNotes.trim()) {
      errors['courierNotes'] = 'Fill out courier notes';
    }

    this.errors = errors;
    return Object.keys(errors).length === 0;
  }

  private clearError(field: string): void {
    if (!this.errors[field]) {
      return;
    }

    const next = { ...this.errors };
    delete next[field];
    this.errors = next;
  }

  private transitionLocal(nextStep: number): void {
    this.step = nextStep;
    this.fadeIn = true;
    this.persist();
    this.scrollToTop();
  }

  private async transitionRoute(path: string, step: number, submitted: boolean): Promise<void> {
    this.step = step;
    this.submitted = submitted;
    this.fadeIn = true;
    this.persist();
    await this.router.navigateByUrl(path);
  }

  private scrollToTop(): void {
    this.containerRef?.nativeElement.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private persist(): void {
    this.stateStore.set(this.snapshotState());
  }

  private applyState(state: DonationWizardState): void {
    this.step = state.step;
    this.consentProducts = state.consentProducts;
    this.consentLiability = state.consentLiability;
    this.deliveryMethod = state.deliveryMethod;
    this.form = { ...state.form };
    this.donationAmount = state.donationAmount;
    this.customAmount = state.customAmount;
    this.selectedDate = state.selectedDate;
    this.selectedTime = state.selectedTime;
    this.submitted = state.submitted;
  }

  private snapshotState(): DonationWizardState {
    return {
      step: this.step,
      consentProducts: this.consentProducts,
      consentLiability: this.consentLiability,
      deliveryMethod: this.deliveryMethod,
      form: { ...this.form },
      donationAmount: this.donationAmount,
      customAmount: this.customAmount,
      selectedDate: this.selectedDate,
      selectedTime: this.selectedTime,
      submitted: this.submitted,
    };
  }

  private reset(): void {
    this.step = 0;
    this.consentProducts = false;
    this.consentLiability = false;
    this.deliveryMethod = null;
    this.form = { ...DEFAULT_WIZARD_FORM_STATE };
    this.donationAmount = 25;
    this.customAmount = '';
    this.selectedDate = null;
    this.selectedTime = null;
    this.submitted = false;
    this.errors = {};
    this.stateStore.clear();
  }

  private buildPickupDateOptions(): PickupDateOption[] {
    const options: PickupDateOption[] = [];
    const now = new Date();

    for (let dayOffset = 1; dayOffset <= 14; dayOffset += 1) {
      const date = new Date(now);
      date.setDate(now.getDate() + dayOffset);

      const dayOfWeek = date.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }

      options.push({
        iso: date.toISOString().slice(0, 10),
        day: date.toLocaleDateString('en-US', { weekday: 'short' }),
        month: date.toLocaleDateString('en-US', { month: 'short' }),
        date: date.getDate(),
      });

      if (options.length >= 5) {
        break;
      }
    }

    return options;
  }
}
