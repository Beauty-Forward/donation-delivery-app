import { describe, expect, it } from 'vitest';
import { isForwardCourierTransition, roadieEventToStatus } from './roadie-provider.js';

describe('roadieEventToStatus', () => {
  it('maps the happy-path lifecycle events to advancing statuses', () => {
    expect(roadieEventToStatus('shipment.driver_assigned')).toBe('dispatch_requested');
    expect(roadieEventToStatus('shipment.en_route_to_pickup')).toBe('in_transit');
    expect(roadieEventToStatus('shipment.at_pickup')).toBe('in_transit');
    expect(roadieEventToStatus('shipment.pickup_confirmed')).toBe('in_transit');
    expect(roadieEventToStatus('shipment.en_route_to_delivery')).toBe('in_transit');
    expect(roadieEventToStatus('shipment.at_delivery')).toBe('in_transit');
    expect(roadieEventToStatus('shipment.delivery_confirmed')).toBe('delivered');
    expect(roadieEventToStatus('shipment.delivery_confirmed_with_details')).toBe('delivered');
  });

  it('maps the unhappy-path events to delivery_failed', () => {
    expect(roadieEventToStatus('shipment.canceled')).toBe('delivery_failed');
    expect(roadieEventToStatus('shipment.returned')).toBe('delivery_failed');
    expect(roadieEventToStatus('shipment.delivery_attempted')).toBe('delivery_failed');
  });

  it('returns null for events we receive but do not model', () => {
    expect(roadieEventToStatus('shipment.tracking_updated')).toBeNull();
    expect(roadieEventToStatus('grouping.pickup_grouping_identified')).toBeNull();
    expect(roadieEventToStatus('unknown')).toBeNull();
    expect(roadieEventToStatus('')).toBeNull();
  });
});

describe('isForwardCourierTransition', () => {
  it('advances forward along the lifecycle', () => {
    expect(isForwardCourierTransition('queued_for_dispatch', 'dispatch_requested')).toBe(true);
    expect(isForwardCourierTransition('dispatch_requested', 'in_transit')).toBe(true);
    expect(isForwardCourierTransition('in_transit', 'delivered')).toBe(true);
    expect(isForwardCourierTransition('in_transit', 'delivery_failed')).toBe(true);
  });

  it('rejects regressions from out-of-order or redelivered events', () => {
    // delivered donation gets a late en_route ping — must not regress
    expect(isForwardCourierTransition('delivered', 'in_transit')).toBe(false);
    expect(isForwardCourierTransition('in_transit', 'dispatch_requested')).toBe(false);
    // duplicate of the same event
    expect(isForwardCourierTransition('in_transit', 'in_transit')).toBe(false);
  });

  it('does not let the two terminal states overwrite each other (first wins)', () => {
    expect(isForwardCourierTransition('delivered', 'delivery_failed')).toBe(false);
    expect(isForwardCourierTransition('delivery_failed', 'delivered')).toBe(false);
  });

  it('advances from any pre-courier / undefined status (rank -1)', () => {
    expect(isForwardCourierTransition(undefined, 'dispatch_requested')).toBe(true);
    expect(isForwardCourierTransition('awaiting_payment', 'in_transit')).toBe(true);
  });
});
