import { describe, expect, it, vi } from 'vitest';
import { ResendEmailService } from './resend.service.js';
import { WAREHOUSE_ADDRESS } from '../constants/warehouse.js';
import type { DonorInfo, PickupDetails, ShippingDetails, DropoffDetails } from '../models.js';

type FetchArgs = Parameters<typeof fetch>;

interface MockResponseInit {
  status?: number;
  body?: unknown;
}

function makeResponse({ status = 200, body }: MockResponseInit = {}): Response {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function makeFetchMock(responses: Array<MockResponseInit>) {
  const calls: FetchArgs[] = [];
  let i = 0;
  const fn = vi.fn(async (...args: FetchArgs): Promise<Response> => {
    calls.push(args);
    const next = responses[i++];
    if (!next) {
      throw new Error(`Unexpected fetch call #${i}`);
    }
    return makeResponse(next);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const DONOR: DonorInfo = {
  fullName: 'Jane Rivera',
  email: 'jane@example.com',
  phone: '5551234567'
};

const PICKUP: PickupDetails = {
  pickupAddress: {
    line1: '123 Main St',
    city: 'Brooklyn',
    state: 'NY',
    postalCode: '11201'
  },
  warehouseAddress: WAREHOUSE_ADDRESS,
  preferredDate: '2026-06-01',
  preferredTimeWindow: '9 AM – 12 PM'
};

const SHIPPING: ShippingDetails = {
  senderAddress: {
    line1: '500 Oak Rd',
    city: 'Austin',
    state: 'TX',
    postalCode: '78701'
  },
  shippingLabelRequested: true
};

const DROPOFF: DropoffDetails = {
  preferredDate: '2026-06-02',
  preferredTimeWindow: '1 PM – 5 PM',
  locationName: 'Beauty Forward Warehouse',
  locationAddress: WAREHOUSE_ADDRESS,
  referenceCode: 'BF-ABC123'
};

describe('ResendEmailService', () => {
  it('skips fetch and warns when RESEND_API_KEY is empty', async () => {
    const { fn } = makeFetchMock([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new ResendEmailService('', 'onboarding@resend.dev', 'https://api.resend.com', fn);

    await service.sendPickupConfirmationEmail({
      donor: DONOR,
      requestId: 'req_1',
      status: 'queued_for_dispatch',
      pickup: PICKUP,
      courierDispatchId: 'roadie_abc',
      nextSteps: ['step 1']
    });

    expect(fn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'RESEND_API_KEY not set; skipping confirmation email'
    );
    warn.mockRestore();
  });

  it('posts a pickup confirmation with the expected request shape', async () => {
    const { fn, calls } = makeFetchMock([{ status: 200, body: { id: 'email_1' } }]);
    const service = new ResendEmailService(
      'test-key',
      'onboarding@resend.dev',
      'https://api.resend.com',
      fn
    );

    await service.sendPickupConfirmationEmail({
      donor: DONOR,
      requestId: 'req_pickup',
      status: 'queued_for_dispatch',
      pickup: PICKUP,
      courierDispatchId: 'roadie_xyz',
      nextSteps: ['Keep your donation accessible.']
    });

    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = calls[0]!;
    expect(String(url)).toBe('https://api.resend.com/emails');

    const reqInit = init as RequestInit;
    expect(reqInit.method).toBe('POST');
    expect(reqInit.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json'
    });

    const body = JSON.parse(reqInit.body as string);
    expect(body.from).toBe('onboarding@resend.dev');
    expect(body.to).toEqual(['jane@example.com']);
    expect(body.subject).toMatch(/pickup/i);
    expect(body.html).toContain('roadie_xyz');
    expect(body.html).toContain('123 Main St');
  });

  it('posts a shipping confirmation including the warehouse address', async () => {
    const { fn, calls } = makeFetchMock([{ status: 200, body: { id: 'email_2' } }]);
    const service = new ResendEmailService(
      'test-key',
      'onboarding@resend.dev',
      'https://api.resend.com',
      fn
    );

    await service.sendShippingConfirmationEmail({
      donor: DONOR,
      requestId: 'req_shipping',
      status: 'pending_label_purchase',
      shipping: SHIPPING,
      shippingLabelReference: 'quote_123',
      warehouseAddress: WAREHOUSE_ADDRESS,
      nextSteps: ['Watch your inbox.']
    });

    const body = JSON.parse((calls[0]![1] as RequestInit).body as string);
    expect(body.subject).toMatch(/shipping/i);
    expect(body.html).toContain('14 53rd St');
    expect(body.html).toContain('Brooklyn');
    expect(body.html).toContain('quote_123');
  });

  it('posts a donation recovery email referencing the donor email and a CTA', async () => {
    const { fn, calls } = makeFetchMock([{ status: 200, body: { id: 'email_recovery' } }]);
    const service = new ResendEmailService(
      'test-key',
      'onboarding@resend.dev',
      'https://api.resend.com',
      fn
    );

    await service.sendDonationRecoveryEmail({
      donor: DONOR,
      requestId: 'req_recovery'
    });

    const body = JSON.parse((calls[0]![1] as RequestInit).body as string);
    expect(body.subject).toMatch(/pickup is still here/i);
    expect(body.to).toEqual(['jane@example.com']);
    // Abandoned-cart framing: addresses the donor warmly and reminds them of the action.
    expect(body.html).toContain('Jane Rivera');
    expect(body.html).toMatch(/finish my pickup/i);
    // CTA points at the wizard URL by default
    expect(body.html).toContain('donation-delivery-app--beauty-forward.us-east4.hosted.app');
  });

  it('posts a dropoff confirmation including the reference code', async () => {
    const { fn, calls } = makeFetchMock([{ status: 200, body: { id: 'email_3' } }]);
    const service = new ResendEmailService(
      'test-key',
      'onboarding@resend.dev',
      'https://api.resend.com',
      fn
    );

    await service.sendDropoffConfirmationEmail({
      donor: DONOR,
      requestId: 'req_dropoff',
      status: 'dropoff_requested',
      dropoff: DROPOFF,
      dropoffReference: 'BF-ABC123',
      nextSteps: ['Bring your donation.']
    });

    const body = JSON.parse((calls[0]![1] as RequestInit).body as string);
    expect(body.subject).toMatch(/drop-?off/i);
    expect(body.html).toContain('BF-ABC123');
  });

  it('honors a custom RESEND_FROM_EMAIL', async () => {
    const { fn, calls } = makeFetchMock([{ status: 200, body: {} }]);
    const service = new ResendEmailService(
      'test-key',
      'donations@beautyforward.org',
      'https://api.resend.com',
      fn
    );

    await service.sendDropoffConfirmationEmail({
      donor: DONOR,
      requestId: 'req_dropoff',
      status: 'dropoff_requested',
      dropoff: DROPOFF,
      dropoffReference: 'BF-ABC123',
      nextSteps: []
    });

    const body = JSON.parse((calls[0]![1] as RequestInit).body as string);
    expect(body.from).toBe('donations@beautyforward.org');
  });

  it('throws when Resend returns a non-OK status', async () => {
    const { fn } = makeFetchMock([{ status: 422, body: { message: 'invalid recipient' } }]);
    const service = new ResendEmailService(
      'test-key',
      'onboarding@resend.dev',
      'https://api.resend.com',
      fn
    );

    await expect(
      service.sendPickupConfirmationEmail({
        donor: DONOR,
        requestId: 'req_err',
        status: 'queued_for_dispatch',
        pickup: PICKUP,
        nextSteps: []
      })
    ).rejects.toThrow(/Resend send failed: 422/);
  });
});
