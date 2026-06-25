import { z } from 'zod';

// Matches ^f\d+$ or empty string ''
const frontCodeSchema = z
  .string()
  .refine((v) => v === '' || /^f\d+$/.test(v), {
    message: "frontCode must be empty or match ^f\\d+$",
  });

// Either '' or a valid YYYY-MM-DD date
const startDateSchema = z
  .string()
  .refine(
    (v) => {
      if (v === '') return true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
      const [year, month, day] = v.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      return (
        d.getFullYear() === year &&
        d.getMonth() + 1 === month &&
        d.getDate() === day
      );
    },
    { message: "startDate must be '' or a valid YYYY-MM-DD date" }
  );

// Either '' or a valid URL
const landingUrlSchema = z
  .string()
  .refine(
    (v) => {
      if (v === '') return true;
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    },
    { message: "landingUrl must be '' or a valid URL" }
  );

export const funnelCreateSchema = z.object({
  num: z.number().int().positive(),
  frontCode: frontCodeSchema,
  status: z.enum(['active', 'draft']),
  productName: z.string(),
  variant: z.string(),
  landingUrl: landingUrlSchema,
  startDate: startDateSchema,
  blockName: z.string().optional(),
  // AV axes — must be non-empty
  product: z.string().min(1),
  contractor: z.string().min(1),
  channel: z.string().min(1),
  direction: z.string().min(1),
  comment: z.string().optional(),
  timeLabelA: z.string().optional(),
  timeLabelB: z.string().optional(),
  roomsReplayEnabled: z.boolean().optional(),
  // sourceName is optional — when absent, source is auto-derived as `${channel} ${contractor}`
  sourceName: z.string().optional(),
});

export const funnelUpdateSchema = funnelCreateSchema.partial();

export const refCreateSchema = z.object({
  name: z.string().min(1).max(120),
});

// Inferred TypeScript types
export type FunnelCreate = z.infer<typeof funnelCreateSchema>;
export type FunnelUpdate = z.infer<typeof funnelUpdateSchema>;
export type RefCreate = z.infer<typeof refCreateSchema>;
