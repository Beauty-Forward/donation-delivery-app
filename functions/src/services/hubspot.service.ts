export type HubspotDonationMethod = 'pickup' | 'shipping' | 'dropoff';

export interface HubspotDonorUpsertInput {
  email: string;
  fullName: string;
  phone: string;
  borough?: string;
  packageSize?: string;
  donationMethod: HubspotDonationMethod;
  donationAmountUsd?: number;
  // When true, refresh fields on the contact without incrementing donation_count.
  // Used by the Givebutter webhook to update last_donation_amount with the
  // confirmed paid amount after the contact has already been counted at submission.
  refreshOnly?: boolean;
}

export class HubspotService {
  constructor(
    private readonly token: string = process.env['HUBSPOT_PRIVATE_APP_TOKEN'] ?? '',
    private readonly baseUrl: string = 'https://api.hubapi.com',
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async upsertDonorContact(input: HubspotDonorUpsertInput): Promise<void> {
    if (!this.token) {
      console.warn('HUBSPOT_PRIVATE_APP_TOKEN not set; skipping CRM sync');
      return;
    }

    const { firstName, lastName } = splitFullName(input.fullName);

    const properties: Record<string, string | number> = {
      email: input.email,
      firstname: firstName,
      lastname: lastName,
      phone: input.phone,
      donation_method: input.donationMethod
    };

    if (!input.refreshOnly) {
      const currentCount = await this.fetchDonationCount(input.email);
      properties['donation_count'] = currentCount + 1;
    }

    if (input.borough) properties['borough'] = input.borough;
    if (input.packageSize) properties['package_size'] = input.packageSize;
    if (input.donationAmountUsd != null) {
      properties['last_donation_amount'] = input.donationAmountUsd;
    }

    const res = await this.fetchImpl(
      `${this.baseUrl}/crm/v3/objects/contacts/batch/upsert`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: [{ idProperty: 'email', id: input.email, properties }]
        })
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HubSpot upsert failed: ${res.status} ${body}`);
    }
  }

  private async fetchDonationCount(email: string): Promise<number> {
    const url =
      `${this.baseUrl}/crm/v3/objects/contacts/${encodeURIComponent(email)}` +
      `?idProperty=email&properties=donation_count`;

    const res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.token}` }
    });

    if (res.status === 404) return 0;
    if (!res.ok) {
      throw new Error(`HubSpot read failed: ${res.status}`);
    }

    const body = (await res.json()) as {
      properties?: { donation_count?: string | number | null };
    };

    const raw = body.properties?.donation_count;
    if (raw == null || raw === '') return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  if (!trimmed) return { firstName: '', lastName: '' };

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0] ?? '', lastName: '' };
  }

  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' ')
  };
}
