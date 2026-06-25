import { Injectable } from '@angular/core';
import { WarehouseDestination } from '../models/donation.models';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class WarehouseConfigService {
  readonly destination: WarehouseDestination = {
    name: environment.warehouse.name,
    address: {
      line1: environment.warehouse.line1,
      line2: environment.warehouse.line2,
      city: environment.warehouse.city,
      state: environment.warehouse.state,
      postalCode: environment.warehouse.postalCode,
    },
    deliveryNotes: environment.warehouse.deliveryNotes,
  };

  get formattedAddress(): string {
    const { line1, line2, city, state, postalCode } = this.destination.address;
    const lineTwo = line2 ? `${line2}, ` : '';
    return `${line1}, ${lineTwo}${city}, ${state} ${postalCode}`;
  }
}
