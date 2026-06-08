import { AddressInfo, CourierDispatchResult, DonationStatus, PickupDetails } from '../models.js';
import { CourierDispatchInput, CourierDispatchProvider } from './courier-provider.js';

// Maps an inbound Roadie webhook `event` string to the donation status it should
// advance the doc to, or null for events we receive but don't act on (e.g.
// tracking pings, grouping notices). Events are namespaced `shipment.*`; see
// https://docs.roadie.com/. The happy path is:
//   driver_assigned → en_route/at/pickup_confirmed → delivery_confirmed
// and canceled / returned / delivery_attempted are terminal failures.
//
// Status is only ever advanced forward by the caller (a delivered doc ignores a
// late en_route ping), so the absolute ordering here doesn't need to be encoded.
export function roadieEventToStatus(event: string): DonationStatus | null {
  switch (event) {
    case 'shipment.driver_assigned':
      return 'dispatch_requested';
    case 'shipment.en_route_to_pickup':
    case 'shipment.at_pickup':
    case 'shipment.pickup_confirmed':
    case 'shipment.en_route_to_delivery':
    case 'shipment.at_delivery':
      return 'in_transit';
    case 'shipment.delivery_confirmed':
    case 'shipment.delivery_confirmed_with_details':
      return 'delivered';
    case 'shipment.canceled':
    case 'shipment.returned':
    case 'shipment.delivery_attempted':
      return 'delivery_failed';
    default:
      return null;
  }
}

// Rank of each courier status along the pickup lifecycle. The webhook only moves
// a doc forward, so an out-of-order or duplicate event (Roadie may redeliver, and
// events can arrive out of sequence) can't regress a delivered donation back to
// in_transit. Statuses outside this map (e.g. pre-dispatch states) rank -1, so any
// courier event will advance them.
const COURIER_STATUS_RANK: Partial<Record<DonationStatus, number>> = {
  queued_for_dispatch: 0,
  dispatch_requested: 1,
  in_transit: 2,
  delivered: 3,
  delivery_failed: 3,
};

// True if `next` is a forward (or terminal-correcting) transition from `current`.
// delivery_failed and delivered share the top rank: whichever lands first wins and
// neither can overwrite the other, so a delivered donation can't later flip to
// failed on a stray returned event, and vice versa.
export function isForwardCourierTransition(
  current: DonationStatus | undefined,
  next: DonationStatus,
): boolean {
  const currentRank = current != null ? (COURIER_STATUS_RANK[current] ?? -1) : -1;
  const nextRank = COURIER_STATUS_RANK[next] ?? -1;
  return nextRank > currentRank;
}

interface RoadieShipmentResponse {
  id?: string | number;
  status?: string;
  pickup_after?: string;
  deliver_between?: { start?: string; end?: string };
}

export class RoadieCourierProvider implements CourierDispatchProvider {
  private readonly apiKey: string;
  private readonly apiBaseUrl: string;
  private readonly dispatchTimeoutMs: number;
  private readonly warehouseContactName: string;
  private readonly warehouseContactPhone: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    apiKey: string = process.env['ROADIE_API_KEY'] ?? '',
    apiBaseUrl: string = process.env['ROADIE_API_BASE_URL'] ??
      'https://connect-sandbox.roadie.com/v1',
    dispatchTimeoutMs = 10000,
    warehouseContactName: string = process.env['WAREHOUSE_CONTACT_NAME'] ??
      'Beauty Forward Warehouse',
    warehouseContactPhone: string = process.env['WAREHOUSE_CONTACT_PHONE'] ?? '',
    fetchImpl: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.apiBaseUrl = apiBaseUrl;
    this.dispatchTimeoutMs = dispatchTimeoutMs;
    this.warehouseContactName = warehouseContactName;
    this.warehouseContactPhone = warehouseContactPhone;
    this.fetchImpl = fetchImpl;
  }

  async dispatchPickup(input: CourierDispatchInput): Promise<CourierDispatchResult> {
    if (!this.apiKey) {
      throw new Error('ROADIE_API_KEY not configured');
    }

    const body = buildShipmentPayload(input, {
      warehouseContactName: this.warehouseContactName,
      warehouseContactPhone: this.warehouseContactPhone,
    });

    const url = `${this.apiBaseUrl}/shipments`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.dispatchTimeoutMs);

    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      // Idempotent duplicate: a prior request with the same idempotency_key
      // already created this shipment. Treat as success — do NOT book again or
      // fail the donation. We don't get the original shipment id back here, so
      // we return an empty dispatchId; the caller's `courierDispatchId ? ...`
      // guards drop it, preserving the id recorded by the first (200) dispatch.
      if (res.status === 409) {
        console.warn('[roadie] duplicate shipment (409); treating as already dispatched', {
          requestId: input.requestId,
        });
        return { provider: 'roadie', dispatchId: '', status: 'queued', etaWindow: '' };
      }
      if (!res.ok) {
        throw new Error(
          `Roadie create-shipment failed: ${res.status} POST ${url} -> ${text.slice(0, 500)}`,
        );
      }

      const parsed = (text ? JSON.parse(text) : {}) as RoadieShipmentResponse;
      const dispatchId = parsed.id != null ? String(parsed.id) : '';
      if (!dispatchId) {
        throw new Error('Roadie response missing shipment id');
      }

      return {
        provider: 'roadie',
        dispatchId,
        status: parsed.status === 'assigned' ? 'assigned' : 'queued',
        etaWindow: formatEtaWindow(parsed, input.pickup),
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Roadie create-shipment timed out');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

interface PayloadOptions {
  warehouseContactName: string;
  warehouseContactPhone: string;
}

export function buildShipmentPayload(input: CourierDispatchInput, opts: PayloadOptions) {
  const { requestId, donor, pickup } = input;
  const { pickupAfter, deliverStart, deliverEnd } = buildTimeWindow(
    pickup.preferredDate,
    pickup.preferredTimeWindow,
  );

  return {
    reference_id: requestId,
    // Roadie dedupes on this: a duplicate create with the same key yields 409
    // after the first 200, so the callable and the fallback can't both book a
    // courier for the same donation. Falls back to requestId when no shared
    // client key is present. See #113.
    idempotency_key: input.idempotencyKey ?? requestId,
    description: 'Beauty Forward donation pickup',
    items: [
      {
        description: 'Beauty product donation',
        quantity: 1,
        length: 13,
        width: 7,
        height: 6,
        weight: 3,
      },
    ],
    pickup_location: {
      address: toRoadieAddress(pickup.pickupAddress),
      notes: pickup.courierNotes ?? undefined,
      contact: {
        name: donor.fullName,
        phone: donor.phone,
      },
    },
    delivery_location: {
      address: toRoadieAddress(pickup.warehouseAddress),
      notes: pickup.warehouseAddress.instructions ?? undefined,
      contact: {
        name: opts.warehouseContactName,
        phone: opts.warehouseContactPhone,
      },
    },
    pickup_after: pickupAfter.toISOString(),
    deliver_between: {
      start: deliverStart.toISOString(),
      end: deliverEnd.toISOString(),
    },
    time_zone: 'America/New_York',
    options: {
      signature_required: false,
      notifications_enabled: true,
      over_21_required: false,
      decline_insurance: true,
    },
  };
}

function toRoadieAddress(addr: AddressInfo) {
  return {
    street1: addr.line1,
    street2: addr.line2 ?? undefined,
    city: addr.city,
    state: addr.state,
    zip: addr.postalCode,
  };
}

// Donor-entered windows are freeform ("9:00 AM - 11:00 AM", "Morning", "2025-05-20"),
// always meant in NYC local time. Cloud Functions runs in UTC, so naive new Date()
// + setHours would shift the times 4–5 hours into the wrong absolute moment. We
// compute the correct NYC-local instant via Intl-derived offset and return three
// timestamps: pickupAfter (window start), deliverStart (same), deliverEnd (window
// end + 4h, so the driver has real transit time).
const PICKUP_TIMEZONE = 'America/New_York';
const DELIVERY_BUFFER_HOURS = 4;

export function buildTimeWindow(
  preferredDate: string,
  preferredTimeWindow: string,
): { pickupAfter: Date; deliverStart: Date; deliverEnd: Date } {
  const dateYmd = normalizeDateYmd(preferredDate) ?? nextBusinessDayNycYmd();
  const { startHour, endHour } = parseTimeWindow(preferredTimeWindow);

  let pickupAfter = nycLocalToUtc(dateYmd, startHour);
  let deliverEnd = nycLocalToUtc(dateYmd, Math.min(endHour + DELIVERY_BUFFER_HOURS, 23));

  // If the donor picked a window that's already past (e.g. submitted at 11am for the
  // 9-11am slot), push pickup_after to one hour from now and widen deliverEnd to keep
  // a non-zero window.
  const now = new Date();
  const minPickup = now.getTime() + 60 * 60 * 1000;
  if (pickupAfter.getTime() < minPickup) {
    pickupAfter = new Date(minPickup);
    if (deliverEnd.getTime() <= pickupAfter.getTime()) {
      deliverEnd = new Date(pickupAfter.getTime() + DELIVERY_BUFFER_HOURS * 60 * 60 * 1000);
    }
  }

  return { pickupAfter, deliverStart: pickupAfter, deliverEnd };
}

function normalizeDateYmd(input: string): string | undefined {
  // Accept YYYY-MM-DD directly, or anything Date.parse understands (we'll re-emit YMD).
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const ms = Date.parse(input);
  if (Number.isNaN(ms)) return undefined;
  // Use UTC slice for stability; if the input was naive (no tz), Date.parse treats
  // it as UTC, so the YMD aligns with what the donor entered.
  return new Date(ms).toISOString().slice(0, 10);
}

function nextBusinessDayNycYmd(): string {
  // Returns tomorrow's YMD in NYC, so a default falls on the donor's local day.
  const tomorrowUtc = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PICKUP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(tomorrowUtc);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Build the UTC Date corresponding to {dateYmd} {hour}:00:00 in NYC local time.
// Uses Intl to detect EST vs EDT for the given date.
function nycLocalToUtc(dateYmd: string, hour: number): Date {
  const offsetMinutes = nycOffsetMinutes(dateYmd);
  // Treat the wall-clock as UTC, then subtract the NYC offset to recover the true UTC.
  const wallClockUtcMs = Date.parse(`${dateYmd}T${pad2(hour)}:00:00Z`);
  return new Date(wallClockUtcMs - offsetMinutes * 60 * 1000);
}

function nycOffsetMinutes(dateYmd: string): number {
  // Sample noon on the target day; using noon avoids DST-boundary edge cases that
  // can land on the 2am skip/repeat hour.
  const sample = new Date(`${dateYmd}T12:00:00Z`);
  const tzName = new Intl.DateTimeFormat('en-US', {
    timeZone: PICKUP_TIMEZONE,
    timeZoneName: 'longOffset',
  })
    .formatToParts(sample)
    .find((p) => p.type === 'timeZoneName')?.value;
  // tzName looks like "GMT-04:00" (EDT) or "GMT-05:00" (EST).
  const match = tzName?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!match) return -300; // EST fallback
  const sign = match[1] === '+' ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseTimeWindow(input: string): { startHour: number; endHour: number } {
  const lower = (input ?? '').toLowerCase();
  const match = lower.match(
    /(\d{1,2})(?::\d{2})?\s*(am|pm)?\s*[-–to]+\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?/,
  );
  if (match) {
    const s = to24Hour(Number(match[1]), match[2] ?? match[4]);
    const e = to24Hour(Number(match[3]), match[4] ?? match[2]);
    if (s != null && e != null && e > s) {
      return { startHour: s, endHour: e };
    }
  }
  if (/morning/.test(lower)) return { startHour: 9, endHour: 12 };
  if (/afternoon/.test(lower)) return { startHour: 13, endHour: 17 };
  if (/evening|night/.test(lower)) return { startHour: 17, endHour: 20 };
  return { startHour: 9, endHour: 17 };
}

function to24Hour(hour: number, meridiem?: string): number | null {
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  const m = (meridiem ?? '').toLowerCase();
  if (m === 'pm' && hour < 12) return hour + 12;
  if (m === 'am' && hour === 12) return 0;
  return hour;
}

function formatEtaWindow(parsed: RoadieShipmentResponse, pickup: PickupDetails): string {
  if (parsed.deliver_between?.start && parsed.deliver_between?.end) {
    return `${parsed.deliver_between.start} – ${parsed.deliver_between.end}`;
  }
  return `${pickup.preferredDate} ${pickup.preferredTimeWindow}`;
}
