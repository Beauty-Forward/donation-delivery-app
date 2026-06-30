import { DonorInfo, DropoffDetails, DonationStatus } from '../models.js';
import {
  wrapInBaseLayout,
  formatAddress,
  eyebrowHtml,
  headingHtml,
  bodyTextHtml,
  gridRowHtml,
  sectionHeadingHtml,
  nextStepsHtml,
} from './base-layout.js';

export interface DropoffConfirmationEmailData {
  donor: DonorInfo;
  requestId: string;
  status: DonationStatus;
  dropoff: DropoffDetails;
  nextSteps: string[];
}

export function buildDropoffConfirmationEmail(data: DropoffConfirmationEmailData): {
  subject: string;
  html: string;
} {
  const { donor, dropoff, nextSteps } = data;

  const locationRows = [
    gridRowHtml('Location', dropoff.locationName),
    gridRowHtml('Address', formatAddress(dropoff.locationAddress)),
    gridRowHtml('Hours', 'Mon\u2013Fri, 9 AM \u2013 5 PM'),
  ].join('');

  const body = `
    ${eyebrowHtml('Drop-off scheduled')}
    ${headingHtml('Your drop-off is confirmed')}
    ${bodyTextHtml(`Hi ${donor.fullName}, thank you for donating with Beauty Forward. Please bring your items to our warehouse and leave them with the front desk. Make sure to say you are dropping of a package for Beauty Forward.`)}

    ${sectionHeadingHtml('Drop-off Details')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${locationRows}
    </table>

    ${nextStepsHtml('How it works', nextSteps)}
  `;

  return {
    subject: 'Your Beauty Forward drop-off is confirmed',
    html: wrapInBaseLayout(body),
  };
}
