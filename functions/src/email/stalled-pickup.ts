import { DonorInfo } from '../models.js';
import { wrapInBaseLayout, eyebrowHtml, headingHtml, bodyTextHtml } from './base-layout.js';
import { COLORS } from './base-layout.js';

// Payment_verification_failed and awaiting_dispatch are the two situations
// the confirmation page promises a 24-hour follow-up email for.
// Kept as a discriminator so the scheduled SLA loop can map
// the backend's metadata.verificationFailureReason onto the right copy:
//
//   'dispatch_delayed' — Givebutter confirmed payment, only the Roadie courier
//                        booking failed. We KNOW the donor paid. Page copy:
//                        "We'll confirm your pickup within 24 hours."
//   'payment_pending'  — Givebutter's API was unreachable, so payment is unknown.
//                        Page copy: "We'll email you within 24 hours with next steps."
export type StalledPickupSituation = 'dispatch_delayed' | 'payment_pending';

export interface StalledPickupEmailData {
  donor: DonorInfo;
  requestId: string;
  situation: StalledPickupSituation;
  // Only present for 'dispatch_delayed', where Givebutter verified the amount.
  verifiedAmountUsd?: number;
}

export function buildStalledPickupEmail(data: StalledPickupEmailData): {
  subject: string;
  html: string;
} {
  const { donor, situation, verifiedAmountUsd } = data;

  if (situation === 'dispatch_delayed') {
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

  // payment_pending
  const body = `
    ${eyebrowHtml('Confirming your payment')}
    ${headingHtml('We’re still confirming your payment')}
    ${bodyTextHtml(
      `Hi ${donor.fullName} — thanks for starting a pickup with Beauty Forward. We’re finishing confirming your payment on our end. As soon as it’s confirmed, we’ll email you to lock in your pickup window.`,
    )}
    ${bodyTextHtml(
      `Please don’t start over or donate again — if we need anything from you, we’ll reach out right here. Questions? Email us at <a href="mailto: info@beauty-forward.org" style="color:${COLORS.heading};">info@beauty-forward.org</a>.`,
    )}
  `;

  return {
    subject: 'We’re confirming your Beauty Forward donation',
    html: wrapInBaseLayout(body),
  };
}
