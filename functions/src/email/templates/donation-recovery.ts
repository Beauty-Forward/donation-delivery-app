import { DonorInfo } from '../../models.js';
import {
  wrapInBaseLayout,
  eyebrowHtml,
  headingHtml,
  bodyTextHtml,
  ctaButtonHtml,
} from './base-layout.js';

export interface DonationRecoveryEmailData {
  donor: DonorInfo;
  requestId: string;
  // Where to send the donor to restart the flow. Defaults to the public wizard URL,
  // but the caller can override (e.g. point at the Givebutter campaign directly).
  ctaUrl?: string;
}

const DEFAULT_CTA_URL = 'https://donation-delivery-app--beauty-forward.us-east4.hosted.app/';

export function buildDonationRecoveryEmail(data: DonationRecoveryEmailData): {
  subject: string;
  html: string;
} {
  const { donor, ctaUrl = DEFAULT_CTA_URL } = data;

  const body = `
    ${eyebrowHtml('Donation not found')}
    ${headingHtml("We couldn't find your donation")}
    ${bodyTextHtml(
      `Hi ${donor.fullName}, you submitted a pickup request but we didn't see a matching donation through Givebutter using <strong>${donor.email}</strong>. If you'd still like to donate to Beauty Forward, tap below to start a new request.`,
    )}
    ${bodyTextHtml(
      `If you think this is a mistake — for example, you donated using a different email — reply to this email and we'll sort it out.`,
    )}
    ${ctaButtonHtml('Start a new donation', ctaUrl)}
  `;

  return {
    subject: "We couldn't find your donation",
    html: wrapInBaseLayout(body),
  };
}
