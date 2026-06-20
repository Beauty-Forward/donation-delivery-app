import type { AddressInfo } from '../models.js';

// Brand palette for transactional emails. Values mirror the Angular app's
// semantic CSS custom properties in
// src/app/features/wizard/donation-wizard-page.component.scss so app + email
// share one vocabulary. NOTE: these interpolate to literal inline hex in the
// rendered HTML on purpose — email clients (Outlook, Gmail) do not support CSS
// custom properties or reliably honor <style> blocks, so `var(--x)` cannot be
// used in the output. The constant lives in the source only.
export const COLORS = {
  textMain: '#181000', // body text, grid values, MSO logo fallback
  textSoft: '#6b6560', // eyebrows, labels, footer, list items, notes
  heading: '#295018', // brand green: headings, footer link
  accent: '#181000', // CTA button background (mirrors app --accent; == textMain today)
  border: '#e8e4de', // card + grid-row borders
  cardBg: '#ffffff', // card background, CTA button text
  panelBg: '#fcfaf7', // outer page background
} as const;

export function wrapInBaseLayout(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Beauty Forward</title>
  <!--[if mso]>
  <style>
    table, td { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:${COLORS.panelBg}; -webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.panelBg};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%;">

          <!-- Header — Logo -->
          <tr>
            <td style="padding:0 0 24px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <!--[if mso]>
                    <span style="font-family:Arial, sans-serif; font-size:20px; font-weight:700; color:${COLORS.textMain};">Beauty Forward</span>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <img src="https://donation-delivery-app--beauty-forward.us-east4.hosted.app/beauty-forward-wordmark.png" alt="Beauty Forward" width="200" style="display:block; height:auto; border:0;" />
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.cardBg}; border:1px solid ${COLORS.border}; border-radius:12px;">
                <tr>
                  <td style="padding:32px 28px;">
                    ${bodyHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 0 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:'Open Sauce Sans', Arial, Helvetica, sans-serif; font-size:13px; color:${COLORS.textSoft}; line-height:1.6; text-align:center;">
                    Questions? Reply to this email or reach us at
                    <a href="mailto:info@beauty-forward.org" style="color:${COLORS.heading}; text-decoration:none;">info@beauty-forward.org</a>
                  </td>
                </tr>
                <tr>
                  <td style="font-family:'Open Sauce Sans', Arial, Helvetica, sans-serif; font-size:12px; color:${COLORS.textSoft}; text-align:center; padding-top:8px;">
                    Beauty Forward &mdash; Brooklyn, NY
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function formatAddress(address: AddressInfo): string {
  const line2 = address.line2 ? `${address.line2}, ` : '';
  return `${address.line1}, ${line2}${address.city}, ${address.state} ${address.postalCode}`;
}

export function formatDate(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00`);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function eyebrowHtml(text: string): string {
  return `<p style="margin:0 0 4px 0; font-family:'Alte Haas Grotesk', Arial, Helvetica, sans-serif; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:${COLORS.textSoft};">${text}</p>`;
}

export function headingHtml(text: string): string {
  return `<h1 style="margin:0 0 12px 0; font-family:'Alte Haas Grotesk', Arial, Helvetica, sans-serif; font-size:22px; font-weight:700; color:${COLORS.heading}; line-height:1.2; letter-spacing:-0.02em;">${text}</h1>`;
}

export function bodyTextHtml(text: string): string {
  return `<p style="margin:0 0 24px 0; font-family:'Open Sauce Sans', Arial, Helvetica, sans-serif; font-size:15px; color:${COLORS.textMain}; line-height:1.6;">${text}</p>`;
}

export function gridRowHtml(label: string, value: string): string {
  return `<tr>
  <td style="padding:10px 0; border-bottom:1px solid ${COLORS.border};">
    <p style="margin:0 0 2px 0; font-family:'Alte Haas Grotesk', Arial, Helvetica, sans-serif; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:${COLORS.textSoft};">${label}</p>
    <p style="margin:0; font-family:'Open Sauce Sans', Arial, Helvetica, sans-serif; font-size:15px; color:${COLORS.textMain};">${value}</p>
  </td>
</tr>`;
}

export function sectionHeadingHtml(text: string): string {
  return `<h3 style="margin:24px 0 8px 0; font-family:'Alte Haas Grotesk', Arial, Helvetica, sans-serif; font-size:15px; font-weight:700; color:${COLORS.heading};">${text}</h3>`;
}

export function nextStepsHtml(heading: string, steps: string[]): string {
  const items = steps
    .map(
      (step) =>
        `<li style="margin-bottom:6px; font-family:'Open Sauce Sans', Arial, Helvetica, sans-serif; font-size:14px; color:${COLORS.textSoft}; line-height:1.5;">${step}</li>`,
    )
    .join('\n          ');

  return `${sectionHeadingHtml(heading)}
      <ul style="margin:0; padding-left:18px;">
        ${items}
      </ul>`;
}

export function ctaButtonHtml(text: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
  <tr>
    <td style="background-color:${COLORS.accent}; border-radius:999px;">
      <a href="${url}" target="_blank" style="display:inline-block; padding:12px 24px; font-family:'Alte Haas Grotesk', Arial, Helvetica, sans-serif; font-size:14px; font-weight:700; color:${COLORS.cardBg}; text-decoration:none;">
        ${text}
      </a>
    </td>
  </tr>
</table>`;
}
