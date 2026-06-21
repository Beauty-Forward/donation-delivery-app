import { CourierDispatchInput, CourierDispatchResult } from '../models.js';

export interface CourierDispatchProvider {
  dispatchPickup(input: CourierDispatchInput): Promise<CourierDispatchResult>;
}
