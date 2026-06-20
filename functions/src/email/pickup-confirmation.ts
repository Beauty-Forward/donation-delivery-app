import { DonorInfo, PickupDetails, DonationStatus } from '../models.js';
import {
  COLORS,
  wrapInBaseLayout,
  formatAddress,
  formatDate,
  eyebrowHtml,
  headingHtml,
  bodyTextHtml,
  gridRowHtml,
  sectionHeadingHtml,
  nextStepsHtml,
} from './base-layout.js';

export interface PickupConfirmationEmailData {
  donor: DonorInfo;
  status: DonationStatus;
  pickup: PickupDetails;
  nextSteps: string[];
}

export function buildPickupConfirmationEmail(data: PickupConfirmationEmailData): {
  subject: string;
  html: string;
} {
  const { donor, pickup, nextSteps } = data;

  const pickupDetailsRows = [
    gridRowHtml('Pickup Date', formatDate(pickup.preferredDate)),
    gridRowHtml('Time Window', pickup.preferredTimeWindow),
    gridRowHtml('Pickup Address', formatAddress(pickup.pickupAddress)),
    gridRowHtml('Destination', formatAddress(pickup.warehouseAddress)),
  ].join('');

  const notesSection = pickup.courierNotes
    ? `${sectionHeadingHtml('Notes for the Courier')}
      <p style="margin:0; font-family:'Open Sauce Sans', Arial, Helvetica, sans-serif; font-size:14px; color:${COLORS.textSoft}; line-height:1.5;">${pickup.courierNotes}</p>`
    : '';

  const body = `
    ${eyebrowHtml('Pickup submitted')}
    ${headingHtml('Your pickup request is confirmed')}
    ${bodyTextHtml(`Hi ${donor.fullName}, thank you for donating with Beauty Forward. We\u2019ll follow up by email and text with courier timing.`)}

    ${sectionHeadingHtml('Pickup Details')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${pickupDetailsRows}
    </table>

    ${notesSection}
    ${nextStepsHtml('What happens next', nextSteps)}
  `;

  return {
    subject: 'Your Beauty Forward pickup is confirmed',
    html: wrapInBaseLayout(body),
  };
}
