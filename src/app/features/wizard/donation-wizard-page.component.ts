import { CommonModule } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectorRef,
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
  ConfirmationView,
  DEFAULT_WIZARD_FORM_STATE,
  DeliveryMethod,
  DonationWizardState,
  DonationWizardStateService,
  WizardFailureReason,
  WizardFormState,
} from '../../core/services/donation-wizard-state.service';
import { DonationApiService } from '../../core/services/donation-api.service';
import { WarehouseConfigService } from '../../core/services/warehouse-config.service';
import {
  AddressInfo,
  CreateDonationRequestPayload,
  DonationSubmissionResult,
  DonationType,
} from '../../core/models/donation.models';
import { environment } from '../../../environments/environment';
import { NYC_CITIES, US_STATES } from '../../core/constants/us-states';

// The Givebutter widget script (loaded in src/index.html) installs a global queueing
// function `window.Givebutter(...)` exposing addEventListener / EVENT constants.
// See https://docs.givebutter.com/docs/elements-donation-events.
type GivebutterEventCallback = (donationObj: {
  sessionId: string;
  amount?: number;
  total?: number;
}) => void;
type GivebutterGlobal = {
  (action: 'addEventListener', event: string, cb: GivebutterEventCallback): void;
  (action: 'removeEventListener', event: string, cb: GivebutterEventCallback): void;
  EVENT?: { DONATION?: { COMPLETE?: string } };
};

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
  // The app runs in zoneless mode (NoopNgZone — no zone.js polyfill). Async callbacks
  // and post-await microtasks don't automatically trigger change detection. We
  // explicitly call cdr.markForCheck()/detectChanges() after any state mutation
  // that needs to land in the template.
  private readonly cdr = inject(ChangeDetectorRef);

  protected readonly bfEmail = environment.email;
  protected readonly nycCities = NYC_CITIES;
  protected readonly states = US_STATES;
  protected readonly packageSizes: PackageOption[] = [
    { id: 'small', label: 'Small', description: 'Fits in a shoebox' },
    { id: 'medium', label: 'Medium', description: 'Fits in the front seat of a car' },
    { id: 'large', label: 'Large', description: 'Fits in the back seat of a car' },
  ];
  protected readonly pickupDonationMin = environment.pickupDonationMinimumUsd;
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
      description:
        'We send a courier to collect from your door. A small donation covers the cost. Available in all five NYC boroughs.',
      tag: 'Most popular',
    },
    {
      id: 'dropoff',
      title: 'Drop Off',
      description:
        'Bring your donation to our Brooklyn warehouse during business hours. Available Tuesdays and Thursdays. Free.',
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
  protected gbSessionId: string | null = null;
  protected gbAmountUsd: number | null = null;
  // True while createDonationRequest is in flight — drives the Confirm button's
  // disabled/loading state so the donor sees feedback instead of a frozen button.
  protected isSubmitting = false;
  protected selectedDate: string | null = null;
  protected selectedTime: string | null = null;
  protected submitted = false;
  protected submittedRequestId: string | null = null;
  // Drives the courier confirmation page: 'verifying' renders the spinner pane while
  // createDonationRequest is in flight, 'success' renders "You are all set" with the
  // verified donation amount, 'failed' renders the error pane with a Try-again CTA
  // back to the donation widget. Non-courier flows skip 'verifying' entirely.
  protected confirmationView: ConfirmationView = 'verifying';
  // When confirmationView is 'failed', this explains *why* so the template can
  // show truthful copy. The awaiting_payment variants must NOT prompt the donor
  // to pay again: 'payment_verified_dispatch_failed' means Givebutter confirmed
  // payment but the courier booking failed (they definitely paid), and
  // 'awaiting_payment' means Givebutter's API was unreachable so we can't yet
  // tell (they may have paid). 'payment_verification_failed' is a real
  // "no payment found", where the Try-again CTA is correct. null means no
  // classified failure — either no failure, or our backend never returned a
  // usable result (the call threw); it renders the same Try-again pane.
  protected failureReason: WizardFailureReason | null = null;
  // Amount Givebutter actually confirmed — surfaced on the success pane. Distinct
  // from gbAmountUsd, which is the donor's intended amount captured client-side and
  // can be wrong/missing because the widget event doesn't always propagate.
  protected verifiedAmountUsd: number | null = null;
  protected fadeIn = true;
  protected errors: Record<string, string> = {};

  private gbListenerRegistered = false;
  // Single-fire guard for runPickupVerification. Replaces a previous brittle
  // dependency on isSubmitting (which can be either true or false depending on
  // whether Angular destroys/recreates this component during nav vs reuses it).
  // Reset by reset() and tryAgainFromFailedDonation so retries can fire again.
  private pickupVerificationStarted = false;

  constructor() {
    this.applyState(this.stateStore.get());
  }

  ngOnInit(): void {
    this.registerGivebutterListener();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        startWith(new NavigationEnd(0, this.router.url, this.router.url)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        const mode = this.resolveModeFromUrl(this.router.url);
        console.info('[wizard] router event:', {
          url: this.router.url,
          mode,
          confirmationView: this.confirmationView,
          isSubmitting: this.isSubmitting,
          deliveryMethod: this.deliveryMethod,
          formEmail: this.form.email,
          pickupVerificationStarted: this.pickupVerificationStarted,
        });
        this.syncToMode(mode);
        // /pickup/confirmation: confirmDonation() on the previous instance just
        // navigates here with confirmationView='verifying' persisted. THIS instance
        // (whether freshly mounted or reused by Angular) owns the actual API call
        // so the spinner pane and the in-flight promise live together.
        if (mode === 'pickup-confirmation') {
          console.info('[wizard] /pickup/confirmation reached', {
            view: this.confirmationView,
            isSubmitting: this.isSubmitting,
            method: this.deliveryMethod,
            email: this.form.email,
            pickupVerificationStarted: this.pickupVerificationStarted,
          });
          if (this.confirmationView === 'verifying' && !this.pickupVerificationStarted) {
            if (this.deliveryMethod === 'courier' && this.form.email) {
              console.info('[wizard] kicking off runPickupVerification');
              this.pickupVerificationStarted = true;
              void this.runPickupVerification();
            } else {
              // Cold landing on /pickup/confirmation with no draft. Show the
              // failure pane so the donor has a path back via Try again.
              console.info('[wizard] cold landing — showing failed', {
                method: this.deliveryMethod,
                email: this.form.email,
              });
              this.confirmationView = 'failed';
              this.cdr.markForCheck();
            }
          } else {
            console.info('[wizard] verifying-trigger skipped', {
              view: this.confirmationView,
              alreadyStarted: this.pickupVerificationStarted,
            });
          }
        }
        // Non-courier confirmations are always success — no verification gate.
        if (mode === 'dropoff-confirmation' || mode === 'shipping-confirmation') {
          this.confirmationView = 'success';
          this.cdr.markForCheck();
        }
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
            `${this.form.city}, ${this.form.state} ${this.form.zip}`,
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
          lines: [this.gbAmountUsd != null ? `$${this.gbAmountUsd}` : 'Pending'],
        },
      );
    }

    if (this.deliveryMethod === 'dropoff') {
      sections.push(
        {
          label: this.warehouse.name,
          lines: [
            this.warehouse.line1,
            this.warehouse.line2,
            `${this.warehouse.city}, ${this.warehouse.state} ${this.warehouse.zip}`,
            this.warehouse.hours,
          ],
        },
        { label: 'Donating from', lines: [`${this.form.city}, ${this.form.state}`] },
        { label: 'Dropoff Notes', lines: [this.form.dropoffNotes] },
      );
    }

    if (this.deliveryMethod === 'ship') {
      sections.push(
        {
          label: 'Ship to',
          lines: [
            this.warehouse.name,
            `${this.warehouse.line1} ${this.warehouse.line2}`,
            `${this.warehouse.city}, ${this.warehouse.state} ${this.warehouse.zip}`,
          ],
        },
        { label: 'Donating from', lines: [`${this.form.city}, ${this.form.state}`] },
      );
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
      // Prefer the verified amount from the callable (server confirmed this was paid).
      // gbAmountUsd is the donor's intended amount captured from the widget event,
      // which is unreliable (event doesn't always propagate from the iframe). Only
      // falls back to it on the review step before submission.
      const donationValue =
        this.verifiedAmountUsd != null
          ? `$${this.verifiedAmountUsd}`
          : this.gbAmountUsd != null
            ? `$${this.gbAmountUsd}`
            : 'Pending';
      rows.push(
        {
          label: 'When',
          value: `${this.pickupDateLabel}, ${this.selectedTime}`,
        },
        {
          label: 'Address',
          value: `${this.form.addressLine1}, ${this.form.city}, ${this.form.state}`,
        },
        {
          label: 'Donation',
          value: donationValue,
        },
      );
    }

    if (this.deliveryMethod === 'dropoff') {
      rows.push(
        {
          label: this.warehouse.name,
          value: `${this.warehouse.line1} ${this.warehouse.line2} ${this.warehouse.city} ${this.warehouse.state}, ${this.warehouse.zip}`,
        },
        {
          label: 'Donating from',
          value: `${this.form.city}, ${this.form.state}`,
        },
      );
    }

    if (this.deliveryMethod === 'ship') {
      rows.push(
        {
          label: 'Ship to',
          value: `${this.warehouse.line1} ${this.warehouse.line2} ${this.warehouse.city} ${this.warehouse.state}, ${this.warehouse.zip}`,
        },
        {
          label: 'Donating from',
          value: `${this.form.city}, ${this.form.state}`,
        },
      );
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
    this.ensureMethodDefaults();
    this.persist();
  }

  private ensureMethodDefaults(): void {
    if (this.deliveryMethod === 'courier' && this.form.state !== 'NY') {
      this.form = { ...this.form, state: 'NY' };
    }
  }

  protected toggleConsentProducts(): void {
    this.consentProducts = !this.consentProducts;
    this.persist();
  }

  protected toggleConsentLiability(): void {
    this.consentLiability = !this.consentLiability;
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

    if (!this.validateDropoffTime()) {
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

  protected async confirmDonation(): Promise<void> {
    console.info('[wizard] confirmDonation: clicked', {
      deliveryMethod: this.deliveryMethod,
      isSubmitting: this.isSubmitting,
    });
    if (!this.deliveryMethod || this.isSubmitting) {
      return;
    }

    this.isSubmitting = true;

    if (this.deliveryMethod === 'courier') {
      // Hand off to /pickup/confirmation. Whichever component instance ends up
      // active there (a fresh mount if Angular destroys/recreates, or this same
      // instance if Angular reuses) owns the actual API call. The single-fire
      // flag pickupVerificationStarted prevents double-firing in either case.
      this.confirmationView = 'verifying';
      this.verifiedAmountUsd = null;
      this.submittedRequestId = null;
      this.pickupVerificationStarted = false;
      this.persist();
      console.info('[wizard] confirmDonation: navigating to /pickup/confirmation');
      await this.transitionRoute('/pickup/confirmation', 6, true);
      // Reset isSubmitting so a future Try-again retry can fire. If Angular
      // destroyed this instance during nav, this assignment is a harmless no-op
      // on the dead reference; if Angular reused this instance, it's necessary.
      this.isSubmitting = false;
      return;
    }

    // Dropoff/ship: no spinner page, no verification gate. Synchronous submit
    // is fine because we navigate straight to the success page after.
    let nonCourierResult: DonationSubmissionResult | null = null;
    try {
      nonCourierResult = await this.persistDonation();
    } catch (err) {
      console.warn('Failed to persist donation_request from wizard', err);
    }
    this.submittedRequestId = nonCourierResult?.requestId ?? null;
    this.confirmationView = 'success';
    this.isSubmitting = false;
    this.cdr.markForCheck();

    if (this.deliveryMethod === 'dropoff') {
      void this.transitionRoute('/dropoff/confirmation', 6, true);
      return;
    }

    void this.transitionRoute('/shipping/confirmation', 6, true);
  }

  // Owned by the /pickup/confirmation component instance: runs the synchronous
  // backend verification + Roadie dispatch, then settles the view based on the
  // real result. Idempotent enough to re-run on refresh-during-spinner — the
  // server-side Givebutter lookup matches by donor email + recent transaction
  // window, so a second submission of the same draft just creates an orphan
  // donation_request and the donor still ends up at success or failed.
  private async runPickupVerification(): Promise<void> {
    if (this.confirmationView !== 'verifying') {
      console.info(
        '[wizard] runPickupVerification: skipped (view already',
        this.confirmationView,
        ')',
      );
      return;
    }
    console.info('[wizard] runPickupVerification: starting API call');
    this.cdr.markForCheck();

    let result: DonationSubmissionResult | null = null;
    try {
      result = await this.persistDonation();
    } catch (err) {
      console.warn('[wizard] persistDonation threw', err);
    }
    console.info('[wizard] persistDonation returned', result);

    this.submittedRequestId = result?.requestId ?? null;
    if (result?.status === 'queued_for_dispatch') {
      this.confirmationView = 'success';
      this.verifiedAmountUsd = result.verifiedAmountUsd ?? null;
      this.failureReason = null;
    } else if (result?.status === 'awaiting_payment' || result?.status === 'verifying_payment') {
      // Two distinct awaiting_payment cases, told apart by the backend's
      // failureReason. Neither shows a "Try again / pay again" CTA.
      this.confirmationView = 'failed';
      if (result?.failureReason === 'courier_dispatch_failed') {
        // Givebutter confirmed payment; only the Roadie courier booking failed.
        // We KNOW the donor paid — reassure them and surface the verified amount.
        this.failureReason = 'payment_verified_dispatch_failed';
        this.verifiedAmountUsd = result.verifiedAmountUsd ?? null;
      } else {
        // Givebutter's API was unreachable, so we can't yet tell whether the
        // donor paid. Acknowledge the request and say we're still confirming.
        this.failureReason = 'awaiting_payment';
      }
    } else if (result?.status === 'payment_verification_failed') {
      // Givebutter confirmed there's no matching transaction — donor genuinely
      // didn't pay. "Try again" is the right CTA here.
      this.confirmationView = 'failed';
      this.failureReason = 'payment_verification_failed';
    } else {
      // No usable result from our backend (the call threw, so we have no status)
      // or an unexpected status. We can't classify the failure, so leave
      // failureReason null — the template renders the generic "couldn't confirm"
      // + Try-again pane, same as 'payment_verification_failed'.
      this.confirmationView = 'failed';
      this.failureReason = null;
    }
    this.persist();
    // Zoneless: callbacks resumed after async boundaries don't auto-trigger CD.
    this.cdr.detectChanges();
  }

  private async persistDonation(): Promise<DonationSubmissionResult | null> {
    if (!this.deliveryMethod) {
      return null;
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

    const donorCity = this.form.city;
    const donorState = this.form.state;

    const warehouseAddress = this.warehouseConfig.destination.address;

    // Conditional spreads — Firestore's SDK rejects `undefined` field values outright
    // (`Unsupported field value: undefined`), and the Cloud Function fallback writes
    // this same object directly to Firestore. So we omit the field entirely when we
    // don't have a value, rather than setting it to undefined.
    const payload: CreateDonationRequestPayload = {
      donationType,
      donor: {
        fullName,
        email: this.form.email,
        phone: this.form.phone,
      },
      contribution: {
        provider: 'givebutter',
        // The donor explicitly attests they completed the donation by clicking through
        // the wizard's "I've completed my donation" button. Server-side verification
        // (verifyContributionAndDispatch) confirms against Givebutter's API by donor email.
        status: this.gbSessionId ? 'checkout_started' : 'not_started',
        ...(this.gbAmountUsd != null ? { amountUsd: this.gbAmountUsd } : {}),
        ...(this.gbSessionId ? { gbSessionId: this.gbSessionId } : {}),
      },
      metadata: {
        flowVersion: 'wizard-v1',
        channel: 'public-web',
        source: 'donation-wizard',
        packageSize: this.form.packageSize,
        city: donorCity,
        state: donorState,
      },
    };

    if (donationType === 'pickup') {
      payload.pickup = {
        pickupAddress: this.buildDonorAddress(donorCity, donorState),
        preferredDate: this.selectedDate ?? '',
        preferredTimeWindow: this.selectedTime ?? '',
        courierNotes: this.form.courierNotes || undefined,
        warehouseAddress,
      };
    } else if (donationType === 'dropoff') {
      payload.dropoff = {
        // The wizard doesn't ask dropoff donors to schedule a slot — they
        // walk in during business hours, so use today's date and a
        // "flexible" window.
        preferredDate: new Date().toISOString().slice(0, 10),
        preferredTimeWindow: 'flexible',
        locationName: this.warehouseConfig.destination.name,
        locationAddress: warehouseAddress,
        dropoffNotes: this.form.dropoffNotes || undefined,
      };
    } else {
      payload.shipping = {
        senderAddress: this.buildDonorAddress(donorCity, donorState),
        shippingLabelRequested: false,
      };
    }

    return this.donationApi.createDonationRequest(payload);
  }

  private buildDonorAddress(city: string, state: string): AddressInfo {
    return {
      line1: this.form.addressLine1 || 'Not provided',
      line2: this.form.addressLine2 || undefined,
      city: city || 'Not provided',
      state: state || 'Not provided',
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

    this.ensureMethodDefaults();
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

    if (this.deliveryMethod) {
      if (!this.form.city.trim()) {
        errors['city'] = this.deliveryMethod === 'courier' ? 'Select a city' : 'Required';
      }

      if (!this.form.state) {
        errors['state'] = 'Select a state';
      }
    }

    if (this.deliveryMethod === 'courier') {
      if (!this.form.addressLine1.trim()) {
        errors['addressLine1'] = 'Required';
      }

      if (!this.form.zip.trim() || this.form.zip.replace(/\D/g, '').length < 5) {
        errors['zip'] = 'Valid ZIP required';
      }
    }

    this.errors = errors;
    return Object.keys(errors).length === 0;
  }

  private validateDonation(): boolean {
    // No client-side gate. The Givebutter Widgets SDK doesn't reliably surface a
    // donation.complete event to our parent page (especially through Google Pay
    // popups), so we trust the donor's "I've completed my donation" click and verify
    // server-side in verifyContributionAndDispatch using a Givebutter API lookup by
    // donor email. If they didn't actually donate, the failure pane catches them
    // within the 2-second confirmation window.
    this.errors = {};
    return true;
  }

  private validateDropoffTime(): boolean {
    if (this.deliveryMethod !== 'dropoff') {
      return true;
    }

    const errors: Record<string, string> = {};

    if (!this.form.dropoffNotes.trim()) {
      errors['dropoffNotes'] = 'Tell us when you plan to come';
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
    this.gbSessionId = state.gbSessionId;
    this.gbAmountUsd = state.gbAmountUsd;
    this.selectedDate = state.selectedDate;
    this.selectedTime = state.selectedTime;
    this.submitted = state.submitted;
    this.submittedRequestId = state.submittedRequestId;
    this.confirmationView = state.confirmationView;
    this.failureReason = state.failureReason;
    this.verifiedAmountUsd = state.verifiedAmountUsd;
    this.ensureMethodDefaults();
  }

  private snapshotState(): DonationWizardState {
    return {
      step: this.step,
      consentProducts: this.consentProducts,
      consentLiability: this.consentLiability,
      deliveryMethod: this.deliveryMethod,
      form: { ...this.form },
      gbSessionId: this.gbSessionId,
      gbAmountUsd: this.gbAmountUsd,
      selectedDate: this.selectedDate,
      selectedTime: this.selectedTime,
      submitted: this.submitted,
      submittedRequestId: this.submittedRequestId,
      confirmationView: this.confirmationView,
      failureReason: this.failureReason,
      verifiedAmountUsd: this.verifiedAmountUsd,
    };
  }

  private reset(): void {
    this.step = 0;
    this.consentProducts = false;
    this.consentLiability = false;
    this.deliveryMethod = null;
    this.form = { ...DEFAULT_WIZARD_FORM_STATE };
    this.gbSessionId = null;
    this.gbAmountUsd = null;
    this.selectedDate = null;
    this.selectedTime = null;
    this.submitted = false;
    this.submittedRequestId = null;
    this.confirmationView = 'verifying';
    this.failureReason = null;
    this.verifiedAmountUsd = null;
    this.isSubmitting = false;
    this.pickupVerificationStarted = false;
    this.errors = {};
    this.cdr.markForCheck();
    this.stateStore.clear();
  }

  private registerGivebutterListener(): void {
    if (this.gbListenerRegistered) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    // The inline stub in index.html guarantees window.Givebutter is a callable
    // queueing function from the very first byte of the page, so we don't need
    // a setTimeout retry here. addEventListener calls registered before the SDK
    // finishes loading get queued and replayed once the loader boots.
    const Givebutter = (window as unknown as { Givebutter?: GivebutterGlobal }).Givebutter;
    if (typeof Givebutter !== 'function') {
      console.warn('[gb] window.Givebutter not callable; check the inline stub in index.html');
      return;
    }
    // String literal event names — the EVENT.* constants object isn't populated
    // until well after the bare function exists, so depending on it can race.
    Givebutter('addEventListener', 'donation.started', this.onGivebutterDonationStarted);
    Givebutter('addEventListener', 'donation.complete', this.onGivebutterDonationComplete);
    this.gbListenerRegistered = true;
    console.info('[gb] listener registered');

    return;
  }

  private onGivebutterDonationStarted: GivebutterEventCallback = (donationObj) => {
    // Diagnostic only — confirms the donor reached the donation form. Cheap insurance
    // while we validate the v3.2 fix; safe to leave on or remove later.
    console.info('[gb] donation.started', donationObj);
  };

  private onGivebutterDonationComplete: GivebutterEventCallback = (donationObj) => {
    // Diagnostic only — the Widgets SDK doesn't reliably fire this from inside the
    // iframe to the parent page, so we don't gate Continue on it. If it does fire,
    // we capture the sessionId as a best-effort hint that downstream code can use
    // (currently unused; retained for forward compatibility).
    console.info('[gb] donation.complete', donationObj);
    if (donationObj && typeof donationObj.sessionId === 'string') {
      this.gbSessionId = donationObj.sessionId;
      this.gbAmountUsd =
        typeof donationObj.amount === 'number'
          ? donationObj.amount
          : typeof donationObj.total === 'number'
            ? donationObj.total
            : null;
      this.persist();
    }
  };

  protected tryAgainFromFailedDonation(): void {
    // Donor took the "Try again" CTA from the failed-verification pane. Reset the
    // captured donation handles (they need to redonate via the widget) but keep the
    // form, schedule, and contact info intact — the wizard state survives in
    // sessionStorage. Navigate them back to step 5 (donation widget).
    this.gbSessionId = null;
    this.gbAmountUsd = null;
    this.verifiedAmountUsd = null;
    this.submittedRequestId = null;
    this.submitted = false;
    this.confirmationView = 'verifying';
    this.failureReason = null;
    this.isSubmitting = false;
    this.pickupVerificationStarted = false;
    this.cdr.markForCheck();
    this.persist();
    void this.transitionRoute('/pickup', 5, false);
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
