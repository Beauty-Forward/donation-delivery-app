import { DonorInfo, DropoffDetails, DonationStatus } from '../models.js';
import {
  wrapInBaseLayout,
  formatAddress,
  formatDate,
  statusDotHtml,
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
  const { donor, requestId, status, dropoff, nextSteps } = data;

  let gridRows = gridRowHtml('Request ID', requestId);
  gridRows += gridRowHtml('Status', status);

  const locationRows = [
    gridRowHtml('Location', dropoff.locationName),
    gridRowHtml('Address', formatAddress(dropoff.locationAddress)),
    gridRowHtml('Drop-off Date', formatDate(dropoff.preferredDate)),
    gridRowHtml('Time Window', dropoff.preferredTimeWindow),
    gridRowHtml('Hours', 'Mon\u2013Fri, 9 AM \u2013 5 PM'),
  ].join('');

  const notesSection = dropoff.dropoffNotes
    ? `${sectionHeadingHtml('Drop-off Notes')}
      <p style="margin:0; font-family:'Open Sauce Sans', Arial, Helvetica, sans-serif; font-size:14px; color:#6b6560; line-height:1.5;">${dropoff.dropoffNotes}</p>`
    : '';

  const body = `
    ${statusDotHtml()}
    ${eyebrowHtml('Drop-off scheduled')}
    ${headingHtml('Your drop-off is confirmed')}
    ${bodyTextHtml(`Hi ${donor.fullName}, thank you for donating with Beauty Forward. Check in with your name at the front desk when you arrive.`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${gridRows}
    </table>

    ${sectionHeadingHtml('Drop-off Details')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${locationRows}
    </table>

    ${notesSection}
    ${nextStepsHtml('What to bring', nextSteps)}
  `;

  return {
    subject: 'Your Beauty Forward drop-off is confirmed',
    html: wrapInBaseLayout(body),
  };
}
