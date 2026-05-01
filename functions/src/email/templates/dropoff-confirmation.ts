import { DonorInfo, DropoffDetails, DonationStatus } from '../../models.js';
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
  dropoffReference?: string;
  nextSteps: string[];
}

export function buildDropoffConfirmationEmail(data: DropoffConfirmationEmailData): { subject: string; html: string } {
  const { donor, requestId, status, dropoff, dropoffReference, nextSteps } = data;

  const referenceChip = dropoffReference
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 20px 0;">
        <tr>
          <td style="background-color:rgba(193, 212, 163, 0.3); border:1px solid rgba(193, 212, 163, 0.5); border-radius:999px; padding:10px 18px;">
            <span style="font-family:'Alte Haas Grotesk', Arial, Helvetica, sans-serif; font-size:16px; font-weight:700; color:#181000; letter-spacing:0.04em;">${dropoffReference}</span>
          </td>
        </tr>
      </table>`
    : '';

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
    ${bodyTextHtml(`Hi ${donor.fullName}, thank you for donating with Beauty Forward. Save your drop-off reference and share it at check-in.`)}

    ${referenceChip}

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
