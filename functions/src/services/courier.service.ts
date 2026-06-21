import { CourierDispatchInput, CourierDispatchResult } from '../models.js';

export interface CourierDispatchService {
  dispatchPickup(input: CourierDispatchInput): Promise<CourierDispatchResult>;
}
