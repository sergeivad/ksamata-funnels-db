import { z } from 'zod';
import { FUNNEL_STATUS_VALUES } from './status';

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
  status: z.enum(FUNNEL_STATUS_VALUES),
  productName: z.string().max(200),
  variant: z.string().max(200),
  landingUrl: landingUrlSchema,
  startDate: startDateSchema,
  blockName: z.string().max(200).optional(),
  // AV axes — must be non-empty after trimming (whitespace-only names would
  // become junk ref rows); become ref rows so bound them like refs
  product: z.string().trim().min(1).max(REF_MAX),
  contractor: z.string().trim().min(1).max(REF_MAX),
  channel: z.string().trim().min(1).max(REF_MAX),
  direction: z.string().trim().min(1).max(REF_MAX),
  comment: z.string().max(2000).optional(),
  timeLabelA: z.string().max(20).optional(),
  timeLabelB: z.string().max(20).optional(),
  roomsReplayEnabled: z.boolean().optional(),
  // sourceName is optional — when absent, source is auto-derived as `${channel} ${contractor}`
  sourceName: z.string().max(REF_MAX).optional(),
});

export const funnelUpdateSchema = funnelCreateSchema.partial();

export const refCreateSchema = z.object({
  // Trim like refRenameSchema does — the two must stay consistent, or a
  // whitespace-only name passes create but not rename.
  name: z.string().trim().min(1).max(120),
});

/**
 * Strict route-param id parser: digits only. parseInt would accept trailing
 * garbage ("12abc" → funnel 12), which masks bad URLs as valid lookups.
 */
export function parseRouteId(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

// Inferred TypeScript types
export type FunnelCreate = z.infer<typeof funnelCreateSchema>;
export type FunnelUpdate = z.infer<typeof funnelUpdateSchema>;
export type RefCreate = z.infer<typeof refCreateSchema>;
