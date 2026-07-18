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

// Shared cap for reference-name fields (product/contractor/channel/direction/
// sourceName). These become rows in the ref tables, so every route that
// writes a ref value (create AND rename) must use this same bound.
export const REF_MAX = 120;

export const funnelCreateSchema = z.object({
  num: z.number().int().positive(),
  frontCode: frontCodeSchema,
  status: z.enum(['active', 'draft']),
  productName: z.string().max(200),
  variant: z.string().max(200),
  landingUrl: landingUrlSchema,
  startDate: startDateSchema,
  blockName: z.string().max(200).optional(),
  // AV axes — must be non-empty; become ref rows so bound them like refs
  product: z.string().min(1).max(REF_MAX),
  contractor: z.string().min(1).max(REF_MAX),
  channel: z.string().min(1).max(REF_MAX),
  direction: z.string().min(1).max(REF_MAX),
  comment: z.string().max(2000).optional(),
  timeLabelA: z.string().max(20).optional(),
  timeLabelB: z.string().max(20).optional(),
  roomsReplayEnabled: z.boolean().optional(),
  // sourceName is optional — when absent, source is auto-derived as `${channel} ${contractor}`
  sourceName: z.string().max(REF_MAX).optional(),
});

export const funnelUpdateSchema = funnelCreateSchema.partial();

export const refCreateSchema = z.object({
  name: z.string().min(1).max(120),
});

// Inferred TypeScript types
export type FunnelCreate = z.infer<typeof funnelCreateSchema>;
export type FunnelUpdate = z.infer<typeof funnelUpdateSchema>;
export type RefCreate = z.infer<typeof refCreateSchema>;
