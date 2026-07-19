import { z } from 'zod';
import { FUNNEL_STATUS_VALUES } from './status';
import { isAxisTag } from './ab-tags';

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

const tagNameSchema = z.string().trim().min(1).max(REF_MAX);

// Axis tags (АВ Продукт/Подрядчик/Канал/Направление) must only ever be
// materialized by the auto axis layer — never typed in manually, or they'd
// be parsed back out as axis values (see getAxesForFunnel / tagNamesToAxes)
// and corrupt the funnel's axes. Used for every path that *adds* a tag name.
const customTagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(REF_MAX)
  .refine((v) => !isAxisTag(v), {
    message:
      'Axis tags (АВ Продукт/Подрядчик/Канал/Направление) are managed automatically and cannot be added manually',
  });

export const tagTemplatePutSchema = z.object({
  names: z.array(customTagNameSchema),
});

const scenarioOverrideSchema = z.object({
  add: z.array(customTagNameSchema).default([]),
  // Lenient on purpose: removes are already defensively dropped by
  // isAxisTag downstream (computeTagSet), so an axis-prefixed remove is
  // harmless — no need to reject it here.
  remove: z.array(tagNameSchema).default([]),
});

// All four scenarios optional; unknown keys rejected (strict).
export const tagsPatchSchema = z
  .object({
    reg: scenarioOverrideSchema.optional(),
    time_15: scenarioOverrideSchema.optional(),
    time_19: scenarioOverrideSchema.optional(),
    messenger: scenarioOverrideSchema.optional(),
  })
  .strict();

// Inferred TypeScript types
export type FunnelCreate = z.infer<typeof funnelCreateSchema>;
export type FunnelUpdate = z.infer<typeof funnelUpdateSchema>;
export type RefCreate = z.infer<typeof refCreateSchema>;
export type TagTemplatePut = z.infer<typeof tagTemplatePutSchema>;
export type TagsPatch = z.infer<typeof tagsPatchSchema>;
