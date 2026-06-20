// Thin Resend API client. Sends transactional confirmation emails via the
// Resend HTTP API. Raw fetch matches the HubspotService / Roadie pattern;
// the templates themselves live in ../email.
//
// Reference: https://resend.com/docs/api-reference/emails/send-email

import {
  buildPickupConfirmationEmail,
  type PickupConfirmationEmailData,
} from '../email/pickup-confirmation.js';
import {
  buildShippingConfirmationEmail,
  type ShippingConfirmationEmailData,
} from '../email/shipping-confirmation.js';
import {
  buildDropoffConfirmationEmail,
  type DropoffConfirmationEmailData,
} from '../email/dropoff-confirmation.js';
import {
  buildDonationRecoveryEmail,
  type DonationRecoveryEmailData,
} from '../email/donation-recovery.js';
import { buildStalledPickupEmail, type StalledPickupEmailData } from '../email/stalled-pickup.js';

export class ResendEmailService {
  constructor(
    private readonly apiKey: string = process.env['RESEND_API_KEY'] ?? '',
    private readonly fromEmail: string = process.env['RESEND_FROM_EMAIL'] ??
      'onboarding@resend.dev',
    private readonly baseUrl: string = 'https://api.resend.com',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendPickupConfirmationEmail(data: PickupConfirmationEmailData): Promise<void> {
    const { subject, html } = buildPickupConfirmationEmail(data);
    await this.send({ to: data.donor.email, subject, html });
  }

  async sendShippingConfirmationEmail(data: ShippingConfirmationEmailData): Promise<void> {
    const { subject, html } = buildShippingConfirmationEmail(data);
    await this.send({ to: data.donor.email, subject, html });
  }

  async sendDropoffConfirmationEmail(data: DropoffConfirmationEmailData): Promise<void> {
    const { subject, html } = buildDropoffConfirmationEmail(data);
    await this.send({ to: data.donor.email, subject, html });
  }

  async sendDonationRecoveryEmail(data: DonationRecoveryEmailData): Promise<void> {
    const { subject, html } = buildDonationRecoveryEmail(data);
    await this.send({ to: data.donor.email, subject, html });
  }

  // The promised "within 24 hours" follow-up for pickups stuck in awaiting_payment
  // (courier booking failed, or Givebutter verification errored). Sent by the
  // sendStalledDonationSlaEmails scheduled loop in index.ts.
  async sendStalledPickupEmail(data: StalledPickupEmailData): Promise<void> {
    const { subject, html } = buildStalledPickupEmail(data);
    await this.send({ to: data.donor.email, subject, html });
  }

  private async send(args: { to: string; subject: string; html: string }): Promise<void> {
    if (!this.apiKey) {
      console.warn('RESEND_API_KEY not set; skipping confirmation email');
      return;
    }

    const res = await this.fetchImpl(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.fromEmail,
        to: [args.to],
        subject: args.subject,
        html: args.html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend send failed: ${res.status} ${body}`);
    }
  }
}
