import { DonorInfo } from '../models.js';
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
    ${eyebrowHtml('Still waiting')}
    ${headingHtml('Want to finish scheduling your pickup?')}
    ${bodyTextHtml(
      `Hi ${donor.fullName} — you started a pickup with Beauty Forward and then life got in the way (we get it). Those untouched PR boxes and unused beauty products taking up space at your place? Women in shelters would actually love them.`,
    )}
    ${bodyTextHtml(`Tap below whenever you're ready. No pressure.`)}
    ${ctaButtonHtml('Finish my pickup', ctaUrl)}
  `;

  return {
    subject: 'Want to finish scheduling your pickup?',
    html: wrapInBaseLayout(body),
  };
}
