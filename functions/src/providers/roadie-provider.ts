import { AddressInfo, CourierDispatchResult, PickupDetails } from '../models.js';
import { CourierDispatchInput, CourierDispatchProvider } from './courier-provider.js';

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
  const { start, end } = buildTimeWindow(pickup.preferredDate, pickup.preferredTimeWindow);

  return {
    reference_id: requestId,
    description: pickup.donationNotes
      ? `Beauty Forward donation pickup. Notes: ${pickup.donationNotes}`
      : 'Beauty Forward donation pickup',
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
      contact: {
        name: donor.fullName,
        phone: donor.phone,
        email: donor.email,
        notes: pickup.pickupAddress.instructions ?? undefined,
      },
    },
    delivery_location: {
      address: toRoadieAddress(pickup.warehouseAddress),
      contact: {
        name: opts.warehouseContactName,
        phone: opts.warehouseContactPhone,
      },
    },
    pickup_after: start.toISOString(),
    deliver_between: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
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

// Donor-entered windows are freeform ("9am-12pm", "Morning", "2025-05-20"). Parse a
// best-effort start/end so Roadie has concrete timestamps; the original strings are
// echoed into the delivery description for the driver.
export function buildTimeWindow(
  preferredDate: string,
  preferredTimeWindow: string,
): { start: Date; end: Date } {
  const baseDate = parseDate(preferredDate) ?? nextBusinessDay();
  const { startHour, endHour } = parseTimeWindow(preferredTimeWindow);

  const start = new Date(baseDate);
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(baseDate);
  end.setHours(endHour, 0, 0, 0);

  // If the parsed window is in the past (e.g. user picked today + an earlier hour),
  // push pickup_after to one hour from now so Roadie can match a driver.
  const now = new Date();
  if (start.getTime() < now.getTime() + 60 * 60 * 1000) {
    start.setTime(now.getTime() + 60 * 60 * 1000);
    if (end.getTime() <= start.getTime()) {
      end.setTime(start.getTime() + 3 * 60 * 60 * 1000);
    }
  }

  return { start, end };
}

function parseDate(input: string): Date | undefined {
  // Try ISO/Date.parse first; fall back to undefined and let caller pick a default.
  const ms = Date.parse(input);
  if (!Number.isNaN(ms)) {
    const d = new Date(ms);
    // Date.parse on a bare YYYY-MM-DD returns midnight UTC; that's fine — caller
    // overwrites hours/minutes.
    return d;
  }
  return undefined;
}

function nextBusinessDay(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

function parseTimeWindow(input: string): { startHour: number; endHour: number } {
  const lower = (input ?? '').toLowerCase();
  const match = lower.match(/(\d{1,2})\s*(am|pm)?\s*[-–to]+\s*(\d{1,2})\s*(am|pm)?/);
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
