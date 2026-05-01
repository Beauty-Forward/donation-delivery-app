import { describe, expect, it, vi } from 'vitest';
import { HubspotService } from './hubspot.service.js';

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

describe('HubspotService.upsertDonorContact', () => {
  it('skips when token is missing and never calls fetch', async () => {
    const { fn } = makeFetchMock([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new HubspotService('', 'https://api.hubapi.com', fn);

    await service.upsertDonorContact({
      email: 'jane@example.com',
      fullName: 'Jane Rivera',
      phone: '5551234567',
      donationMethod: 'dropoff'
    });

    expect(fn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'HUBSPOT_PRIVATE_APP_TOKEN not set; skipping CRM sync'
    );
    warn.mockRestore();
  });

  it('reads donation_count then upserts with count incremented and split name', async () => {
    const { fn, calls } = makeFetchMock([
      { status: 200, body: { properties: { donation_count: '2' } } },
      { status: 200, body: { results: [] } }
    ]);
    const service = new HubspotService('test-token', 'https://api.hubapi.com', fn);

    await service.upsertDonorContact({
      email: 'jane@example.com',
      fullName: 'Jane Rivera',
      phone: '5551234567',
      borough: 'Brooklyn',
      packageSize: 'medium',
      donationMethod: 'dropoff',
      donationAmountUsd: 25
    });

    expect(fn).toHaveBeenCalledTimes(2);

    const [readUrl, readInit] = calls[0]!;
    expect(String(readUrl)).toBe(
      'https://api.hubapi.com/crm/v3/objects/contacts/jane%40example.com?idProperty=email&properties=donation_count'
    );
    expect((readInit as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer test-token'
    });

    const [writeUrl, writeInit] = calls[1]!;
    expect(String(writeUrl)).toBe(
      'https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert'
    );
    const init = writeInit as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      inputs: [
        {
          idProperty: 'email',
          id: 'jane@example.com',
          properties: {
            email: 'jane@example.com',
            firstname: 'Jane',
            lastname: 'Rivera',
            phone: '5551234567',
            donation_method: 'dropoff',
            donation_count: 3,
            borough: 'Brooklyn',
            package_size: 'medium',
            last_donation_amount: 25
          }
        }
      ]
    });
  });

  it('treats a 404 read as donation_count 0 and writes count 1', async () => {
    const { fn, calls } = makeFetchMock([
      { status: 404 },
      { status: 200, body: {} }
    ]);
    const service = new HubspotService('tok', 'https://api.hubapi.com', fn);

    await service.upsertDonorContact({
      email: 'new@example.com',
      fullName: 'New Donor',
      phone: '5550000000',
      donationMethod: 'pickup'
    });

    const init = calls[1]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.inputs[0].properties.donation_count).toBe(1);
  });

  it('handles single-word names by leaving lastname empty', async () => {
    const { fn, calls } = makeFetchMock([
      { status: 404 },
      { status: 200, body: {} }
    ]);
    const service = new HubspotService('tok', 'https://api.hubapi.com', fn);

    await service.upsertDonorContact({
      email: 'cher@example.com',
      fullName: 'Cher',
      phone: '5550000000',
      donationMethod: 'shipping'
    });

    const body = JSON.parse((calls[1]![1] as RequestInit).body as string);
    expect(body.inputs[0].properties.firstname).toBe('Cher');
    expect(body.inputs[0].properties.lastname).toBe('');
  });

  it('joins multi-word last names', async () => {
    const { fn, calls } = makeFetchMock([
      { status: 404 },
      { status: 200, body: {} }
    ]);
    const service = new HubspotService('tok', 'https://api.hubapi.com', fn);

    await service.upsertDonorContact({
      email: 'maria@example.com',
      fullName: 'Maria del Carmen Lopez',
      phone: '5550000000',
      donationMethod: 'dropoff'
    });

    const body = JSON.parse((calls[1]![1] as RequestInit).body as string);
    expect(body.inputs[0].properties.firstname).toBe('Maria');
    expect(body.inputs[0].properties.lastname).toBe('del Carmen Lopez');
  });

  it('omits optional fields from the upsert when not provided', async () => {
    const { fn, calls } = makeFetchMock([
      { status: 200, body: { properties: { donation_count: 0 } } },
      { status: 200, body: {} }
    ]);
    const service = new HubspotService('tok', 'https://api.hubapi.com', fn);

    await service.upsertDonorContact({
      email: 'spare@example.com',
      fullName: 'Spare Donor',
      phone: '5550000000',
      donationMethod: 'dropoff'
    });

    const props = JSON.parse(
      (calls[1]![1] as RequestInit).body as string
    ).inputs[0].properties;
    expect(props.borough).toBeUndefined();
    expect(props.package_size).toBeUndefined();
    expect(props.last_donation_amount).toBeUndefined();
  });

  it('refreshOnly skips the count read and does not set donation_count', async () => {
    const { fn, calls } = makeFetchMock([{ status: 200, body: {} }]);
    const service = new HubspotService('tok', 'https://api.hubapi.com', fn);

    await service.upsertDonorContact({
      email: 'jane@example.com',
      fullName: 'Jane Rivera',
      phone: '5551234567',
      donationMethod: 'dropoff',
      donationAmountUsd: 30,
      refreshOnly: true
    });

    expect(fn).toHaveBeenCalledTimes(1);
    const props = JSON.parse(
      (calls[0]![1] as RequestInit).body as string
    ).inputs[0].properties;
    expect(props.donation_count).toBeUndefined();
    expect(props.last_donation_amount).toBe(30);
  });

  it('throws when the upsert API returns a non-OK status', async () => {
    const { fn } = makeFetchMock([
      { status: 200, body: { properties: { donation_count: '0' } } },
      { status: 500, body: { message: 'boom' } }
    ]);
    const service = new HubspotService('tok', 'https://api.hubapi.com', fn);

    await expect(
      service.upsertDonorContact({
        email: 'jane@example.com',
        fullName: 'Jane Rivera',
        phone: '5551234567',
        donationMethod: 'dropoff'
      })
    ).rejects.toThrow(/HubSpot upsert failed: 500/);
  });

  it('throws when the count read returns a non-OK, non-404 status', async () => {
    const { fn } = makeFetchMock([{ status: 401 }]);
    const service = new HubspotService('tok', 'https://api.hubapi.com', fn);

    await expect(
      service.upsertDonorContact({
        email: 'jane@example.com',
        fullName: 'Jane Rivera',
        phone: '5551234567',
        donationMethod: 'dropoff'
      })
    ).rejects.toThrow(/HubSpot read failed: 401/);
  });
});
