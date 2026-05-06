import { z } from 'zod';

// Lowered (e.g. 1) in non-prod via env so the gate is testable without paying $15 each time.
export const PICKUP_DONATION_MIN_USD = Number(process.env.PICKUP_DONATION_MIN_USD ?? 15);

const addressSchema = z.object({
  line1: z.string().min(3),
  line2: z.string().optional(),
  city: z.string().min(2),
  state: z.string().min(2).max(2),
  postalCode: z.string().min(5),
  instructions: z.string().optional()
});

const donorSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(7),
  donorAccountId: z.string().optional()
});

const contributionSchema = z.object({
  provider: z.literal('givebutter'),
  status: z.enum(['not_started', 'checkout_started', 'completed', 'skipped']),
  amountUsd: z.number().positive().optional(),
  checkoutUrl: z.string().url().optional(),
  gbSessionId: z.string().min(1).optional()
});

const pickupSchema = z.object({
  pickupAddress: addressSchema,
  preferredDate: z.string().min(4),
  preferredTimeWindow: z.string().min(4),
  donationNotes: z.string().optional(),
  warehouseAddress: addressSchema
});

const shippingSchema = z.object({
  senderAddress: addressSchema,
  shippingLabelRequested: z.boolean(),
  packageNotes: z.string().optional(),
  shippingLabelIntentAmountUsd: z.number().positive().optional(),
  shippingLabelQuoteId: z.string().optional()
});

const dropoffSchema = z.object({
  preferredDate: z.string().min(4),
  preferredTimeWindow: z.string().min(4),
  dropoffNotes: z.string().optional(),
  locationName: z.string().min(2),
  locationAddress: addressSchema,
  referenceCode: z.string().optional()
});

export const createDonationRequestSchema = z
  .object({
    donationType: z.enum(['pickup', 'shipping', 'dropoff']),
    donor: donorSchema,
    contribution: contributionSchema,
    pickup: pickupSchema.optional(),
    shipping: shippingSchema.optional(),
    dropoff: dropoffSchema.optional(),
    metadata: z.record(z.unknown()).optional()
  })
  .superRefine((payload, context) => {
    if (payload.donationType === 'pickup' && !payload.pickup) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Pickup details are required for pickup requests.'
      });
    }

    if (payload.donationType === 'shipping' && !payload.shipping) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Shipping details are required for shipping requests.'
      });
    }

    if (payload.donationType === 'dropoff' && !payload.dropoff) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Drop-off details are required for drop-off requests.'
      });
    }

    // Note: pickup donation amount and session id used to be enforced here, but the
    // Givebutter Widgets SDK doesn't reliably surface a sessionId to the parent page,
    // and the donor doesn't enter the amount in our wizard (the widget owns it). The
    // gate is enforced server-side by verifyContributionAndDispatch, which queries
    // Givebutter's API by donor email + amount within the lookback window.
  });

export const createContributionSessionSchema = z.object({
  donationType: z.enum(['pickup', 'shipping', 'dropoff']),
  amountUsd: z.number().positive().optional(),
  donorEmail: z.string().email().optional(),
  requestId: z.string().optional()
});
