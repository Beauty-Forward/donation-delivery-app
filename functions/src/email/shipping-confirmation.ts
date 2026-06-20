import { DonorInfo, ShippingDetails, DonationStatus } from '../models.js';
import {
  wrapInBaseLayout,
  formatAddress,
  statusDotHtml,
  eyebrowHtml,
  headingHtml,
  bodyTextHtml,
  gridRowHtml,
  sectionHeadingHtml,
  nextStepsHtml,
} from './base-layout.js';

export interface ShippingConfirmationEmailData {
  donor: DonorInfo;
  requestId: string;
  status: DonationStatus;
  shipping: ShippingDetails;
  warehouseAddress: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
  };
  nextSteps: string[];
}

export function buildShippingConfirmationEmail(data: ShippingConfirmationEmailData): {
  subject: string;
  html: string;
} {
  const { donor, requestId, status, shipping, warehouseAddress, nextSteps } = data;

  let gridRows = gridRowHtml('Request ID', requestId);

  gridRows += gridRowHtml('Status', status);

  const addressRows = [gridRowHtml('Ship To', formatAddress(warehouseAddress))].join('');

  const notesSection = shipping.packageNotes
    ? `${sectionHeadingHtml('Package Notes')}
      <p style="margin:0; font-family:'Open Sauce Sans', Arial, Helvetica, sans-serif; font-size:14px; color:#6b6560; line-height:1.5;">${shipping.packageNotes}</p>`
    : '';

  const body = `
    ${statusDotHtml()}
    ${eyebrowHtml('Ship your items')}
    ${headingHtml("You're all set")}
    ${bodyTextHtml(`Hi ${donor.fullName}, thanks for donating! Please ship your items to the warehouse address below. Once you've shipped your items, email us at info@beauty-forward.org with your shipping confirmation number so that we can track delivery.`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${gridRows}
    </table>

    ${sectionHeadingHtml('Shipping Details')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${addressRows}
    </table>

    ${notesSection}
    ${nextStepsHtml('Next steps', nextSteps)}
  `;

  return {
    subject: 'Your Beauty Forward donation is confirmed',
    html: wrapInBaseLayout(body),
  };
}
