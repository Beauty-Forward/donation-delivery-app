import { DonorInfo } from '../models.js';
import { wrapInBaseLayout, eyebrowHtml, headingHtml, bodyTextHtml } from './base-layout.js';
import { COLORS } from './base-layout.js';

// Sent by sendStalledDonationSlaEmails when a pickup lands in dispatch_failed:
// Givebutter confirmed payment but the Roadie courier booking failed. We KNOW the
// donor paid (the webhook stashed the verified amount), so the copy reassures them
// the money went through and our team is booking the courier by hand.
export interface StalledPickupEmailData {
  donor: DonorInfo;
  requestId: string;
  // The amount Givebutter verified, when known — shown in the reassurance copy.
  verifiedAmountUsd?: number;
}

export function buildStalledPickupEmail(data: StalledPickupEmailData): {
  subject: string;
  html: string;
} {
  const { donor, verifiedAmountUsd } = data;

  const amountLine =
    typeof verifiedAmountUsd === 'number'
      ? `Your $${verifiedAmountUsd} donation came through — thank you! `
      : `Your donation came through — thank you! `;

  const body = `
    ${eyebrowHtml('Payment received')}
    ${headingHtml('We’re arranging your pickup')}
    ${bodyTextHtml(
      `Hi ${donor.fullName} — ${amountLine}We hit a snag booking the courier automatically, so our team is setting up your pickup by hand. We’ll email you to confirm your pickup window shortly.`,
    )}
    ${bodyTextHtml(
      `There’s nothing you need to do, and there’s no need to donate again. If you have any questions in the meantime, email us at <a href="mailto: info@beauty-forward.org" style="color:${COLORS.heading};">info@beauty-forward.org</a>.`,
    )}
  `;

  return {
    subject: 'We’ve got your donation — arranging your pickup',
    html: wrapInBaseLayout(body),
  };
}
