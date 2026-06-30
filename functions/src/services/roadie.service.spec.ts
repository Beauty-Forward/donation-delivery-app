import { describe, expect, it, vi } from 'vitest';
import { RoadieCourierService, buildShipmentPayload, buildTimeWindow } from './roadie.service.js';
import {
  WAREHOUSE_CONTACT_NAME,
  WAREHOUSE_CONTACT_PHONE,
  WAREHOUSE_INSTRUCTIONS,
} from '../warehouse.js';
import type { CourierDispatchInput } from '../models.js';

type FetchArgs = Parameters<typeof fetch>;

interface MockResponseInit {
  status?: number;
  body?: unknown;
}

function makeResponse({ status = 200, body }: MockResponseInit = {}): Response {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeFetchMock(responses: Array<MockResponseInit>) {
  const calls: FetchArgs[] = [];
  let i = 0;
  const fn = vi.fn(async (...args: FetchArgs): Promise<Response> => {
    calls.push(args);
    const next = responses[i++];
    if (!next) throw new Error(`Unexpected fetch call #${i}`);
    return makeResponse(next);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const farFutureInput: CourierDispatchInput = {
  requestId: 'req_abc123',
  donor: {
    fullName: 'Jane Donor',
    email: 'jane@example.com',
    phone: '5551234567',
  },
  pickup: {
    pickupAddress: {
      line1: '123 Main St',
      line2: 'Apt 4',
      city: 'Brooklyn',
      state: 'NY',
      postalCode: '11201',
    },
    preferredDate: '2099-05-20',
    preferredTimeWindow: '9am-12pm',
    courierNotes: 'Buzz apt 4B, leave with doorman',
    warehouseAddress: {
      line1: '789 Warehouse Way',
      city: 'Queens',
      state: 'NY',
      postalCode: '11101',
    },
    // Required by the type but ignored by buildShipmentPayload — delivery notes
    // come from the WAREHOUSE_INSTRUCTIONS const, not this field. The assertions
    // below prove that by checking the const, not this value.
    warehouseDeliveryInstructions: 'IGNORED — service uses the warehouse const',
  },
};

describe('RoadieCourierService', () => {
  it('throws when ROADIE_API_KEY is not configured', async () => {
    const { fn } = makeFetchMock([]);
    const service = new RoadieCourierService('', 'https://sandbox.roadie.test/v1', 5000, fn);
    await expect(service.dispatchPickup(farFutureInput)).rejects.toThrow(
      /ROADIE_API_KEY not configured/,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('posts to {base}/shipments with Bearer auth and returns the shipment id', async () => {
    const { fn, calls } = makeFetchMock([{ status: 201, body: { id: 'roadie_dlv_99' } }]);
    const service = new RoadieCourierService('sk_test_123', 'https://sandbox.roadie.test/v1', 5000, fn);

    const result = await service.dispatchPickup(farFutureInput);

    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = calls[0]!;
    expect(String(url)).toBe('https://sandbox.roadie.test/v1/shipments');
    const req = init as RequestInit;
    expect(req.method).toBe('POST');
    expect(req.headers).toMatchObject({
      Authorization: 'Bearer sk_test_123',
      'Content-Type': 'application/json',
    });
    expect(result).toBe('roadie_dlv_99');
  });

  it('coerces a numeric shipment id to a string', async () => {
    const { fn } = makeFetchMock([{ status: 201, body: { id: 12345 } }]);
    const service = new RoadieCourierService('sk', 'https://s.test/v1', 5000, fn);

    expect(await service.dispatchPickup(farFutureInput)).toBe('12345');
  });

  it('maps donor + pickup details into the Roadie request body', async () => {
    const { fn, calls } = makeFetchMock([{ status: 201, body: { id: 'd1' } }]);
    const service = new RoadieCourierService('sk_test', 'https://sandbox.roadie.test/v1', 5000, fn);

    await service.dispatchPickup(farFutureInput);

    const body = JSON.parse((calls[0]![1] as RequestInit).body as string);
    expect(body.reference_id).toBe('req_abc123');
    expect(body.description).toBe('Beauty Forward donation pickup');
    expect(body.items).toMatchObject([{ description: 'Beauty product donation', quantity: 1 }]);
    expect(body.pickup_location.address).toEqual({
      street1: '123 Main St',
      street2: 'Apt 4',
      city: 'Brooklyn',
      state: 'NY',
      zip: '11201',
    });
    expect(body.pickup_location.notes).toBe('Buzz apt 4B, leave with doorman');
    expect(body.pickup_location.contact).toEqual({
      name: 'Jane Donor',
      phone: '5551234567',
    });
    expect(body.delivery_location.address).toEqual({
      street1: '789 Warehouse Way',
      city: 'Queens',
      state: 'NY',
      zip: '11101',
    });
    // Delivery notes + contact come from the warehouse consts, not the request.
    expect(body.delivery_location.notes).toBe(WAREHOUSE_INSTRUCTIONS);
    expect(body.delivery_location.contact).toEqual({
      name: WAREHOUSE_CONTACT_NAME,
      phone: WAREHOUSE_CONTACT_PHONE,
    });
    expect(body.time_zone).toBe('America/New_York');
    // pickupAfter for "9am-12pm" on 2099-05-20 (EDT) = 13:00 UTC.
    expect(body.pickup_after).toBe('2099-05-20T13:00:00.000Z');
    // deliverEnd has 4h buffer past window end = 16:00 NYC = 20:00 UTC.
    expect(body.deliver_between.end).toBe('2099-05-20T20:00:00.000Z');
  });

  it('throws with response body when Roadie returns non-2xx', async () => {
    const { fn } = makeFetchMock([{ status: 401, body: { error: 'unauthorized' } }]);
    const service = new RoadieCourierService('bad', 'https://s.test/v1', 5000, fn);

    await expect(service.dispatchPickup(farFutureInput)).rejects.toThrow(
      /Roadie create-shipment failed: 401/,
    );
  });

  it('throws when a 2xx response has no shipment id', async () => {
    // Guards the String(undefined) === "undefined" trap: a missing id must throw,
    // not silently persist the literal string "undefined" as the dispatch id.
    const { fn } = makeFetchMock([{ status: 200, body: { state: 'scheduled' } }]);
    const service = new RoadieCourierService('k', 'https://s.test/v1', 5000, fn);

    await expect(service.dispatchPickup(farFutureInput)).rejects.toThrow(/missing shipment id/);
  });

  it('treats a 409 (duplicate idempotency_key) as already dispatched, not a failure', async () => {
    const { fn } = makeFetchMock([{ status: 409, body: { error: 'duplicate idempotency_key' } }]);
    const service = new RoadieCourierService('k', 'https://s.test/v1', 5000, fn);

    // Must NOT throw — a second dispatch for the same donation is a no-op. Returns
    // '' because Roadie doesn't echo the original shipment id on a 409.
    expect(await service.dispatchPickup(farFutureInput)).toBe('');
  });

  it('sends the requestId as the idempotency_key', async () => {
    const { fn, calls } = makeFetchMock([{ status: 201, body: { id: 'a' } }]);
    const service = new RoadieCourierService('k', 'https://s.test/v1', 5000, fn);

    await service.dispatchPickup(farFutureInput);

    expect(JSON.parse((calls[0]![1] as RequestInit).body as string).idempotency_key).toBe(
      'req_abc123',
    );
  });
});

describe('buildTimeWindow', () => {
  it('interprets a "9am-12pm" window as NYC local time (EDT)', () => {
    const { pickupAfter, deliverStart, deliverEnd } = buildTimeWindow('2099-05-20', '9am-12pm');
    // 9 AM EDT = 13:00 UTC.
    expect(pickupAfter.toISOString()).toBe('2099-05-20T13:00:00.000Z');
    // deliverStart mirrors pickupAfter so Roadie can begin delivery immediately.
    expect(deliverStart.toISOString()).toBe(pickupAfter.toISOString());
    // deliverEnd = window end (12 NYC) + 4h buffer = 16 NYC = 20:00 UTC EDT.
    expect(deliverEnd.toISOString()).toBe('2099-05-20T20:00:00.000Z');
  });

  it('interprets a winter date in NYC as EST', () => {
    // January is EST (UTC-5). 9 AM EST = 14:00 UTC.
    const { pickupAfter } = buildTimeWindow('2099-01-15', '9am-12pm');
    expect(pickupAfter.toISOString()).toBe('2099-01-15T14:00:00.000Z');
  });

  it('parses an "afternoon" label as 1pm-5pm NYC', () => {
    const { pickupAfter, deliverEnd } = buildTimeWindow('2099-05-20', 'Afternoon');
    // 1 PM EDT = 17:00 UTC; 5 PM + 4h = 9 PM EDT = 01:00 UTC next day.
    expect(pickupAfter.toISOString()).toBe('2099-05-20T17:00:00.000Z');
    expect(deliverEnd.toISOString()).toBe('2099-05-21T01:00:00.000Z');
  });

  it.each([
    {
      window: '9:00 AM - 11:00 AM',
      expectedPickup: '2099-05-20T13:00:00.000Z',
      expectedDeliverEnd: '2099-05-20T19:00:00.000Z',
    },
    {
      window: '11:00 AM - 1:00 PM',
      expectedPickup: '2099-05-20T15:00:00.000Z',
      expectedDeliverEnd: '2099-05-20T21:00:00.000Z',
    },
    {
      window: '1:00 PM - 3:00 PM',
      expectedPickup: '2099-05-20T17:00:00.000Z',
      expectedDeliverEnd: '2099-05-20T23:00:00.000Z',
    },
    {
      window: '3:00 PM - 5:00 PM',
      expectedPickup: '2099-05-20T19:00:00.000Z',
      expectedDeliverEnd: '2099-05-21T01:00:00.000Z',
    },
  ])('handles wizard pickup window "$window"', ({ window, expectedPickup, expectedDeliverEnd }) => {
    const { pickupAfter, deliverEnd } = buildTimeWindow('2099-05-20', window);
    expect(pickupAfter.toISOString()).toBe(expectedPickup);
    expect(deliverEnd.toISOString()).toBe(expectedDeliverEnd);
  });

  it('pushes pickupAfter forward when the window is in the past', () => {
    const { pickupAfter, deliverEnd } = buildTimeWindow('2000-01-01', '9am-12pm');
    expect(pickupAfter.getTime()).toBeGreaterThanOrEqual(Date.now());
    expect(deliverEnd.getTime()).toBeGreaterThan(pickupAfter.getTime());
  });
});

describe('buildShipmentPayload', () => {
  it('maps required courier notes and the constant warehouse contact into the payload', () => {
    const body = buildShipmentPayload(farFutureInput);
    expect(body.description).toBe('Beauty Forward donation pickup');
    expect(body.pickup_location.notes).toBe('Buzz apt 4B, leave with doorman');
    expect(body.delivery_location.notes).toBe(WAREHOUSE_INSTRUCTIONS);
    expect(body.delivery_location.contact).toEqual({
      name: WAREHOUSE_CONTACT_NAME,
      phone: WAREHOUSE_CONTACT_PHONE,
    });
  });
});
