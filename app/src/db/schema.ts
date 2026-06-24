import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ─── Lookup tables ────────────────────────────────────────────────────────────

export const sources = sqliteTable('sources', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const tags = sqliteTable('tags', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const products = sqliteTable('products', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const contractors = sqliteTable('contractors', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

// ─── funnels ──────────────────────────────────────────────────────────────────

export const funnels = sqliteTable(
  'funnels',
  {
    id:               integer('id').primaryKey({ autoIncrement: true }),
    num:              integer('num').notNull().unique(),
    sourceId:         integer('source_id').notNull().references(() => sources.id),
    productId:        integer('product_id').notNull().references(() => products.id),
    contractorId:     integer('contractor_id').notNull().references(() => contractors.id),
    variant:          text('variant').notNull().default(''),
    productName:      text('product_name').notNull().default(''),
    landingUrl:       text('landing_url').default(''),
    startDate:        text('start_date').default(''),
    blockName:        text('block_name').default(''),
    sheetName:        text('sheet_name').default(''),
    tag19Raw:         text('tag_19_raw').default(''),
    tag15Raw:         text('tag_15_raw').default(''),
    regTagsRaw:       text('reg_tags_raw').default(''),
    dashSalesUrl:     text('dash_sales_url').default(''),
    dashPedelivUrl:   text('dash_pereliv_url').default(''),
    regiTotalUrl:     text('regi_total_url').default(''),
    regi15Url:        text('regi_15_url').default(''),
    regi19Url:        text('regi_19_url').default(''),
    regiNotimeUrl:    text('regi_notime_url').default(''),
    predspisokUrl:    text('predspisok_url').default(''),
    roomIdsJson:      text('room_ids_json').default('{}'),
    createdAt:        text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt:        text('updated_at').notNull().default(sql`(datetime('now'))`),
    bothelpCondition: text('bothelp_condition').default(''),
    // New columns added by migration
    status:           text('status').default('active'),
    frontCode:        text('front_code').default(''),
  },
  (t) => ({
    productIdx:    index('idx_funnels_product').on(t.productId),
    contractorIdx: index('idx_funnels_contractor').on(t.contractorId),
  }),
);

// ─── funnel_tags ──────────────────────────────────────────────────────────────

export const funnelTags = sqliteTable(
  'funnel_tags',
  {
    id:       integer('id').primaryKey({ autoIncrement: true }),
    funnelId: integer('funnel_id').notNull().references(() => funnels.id, { onDelete: 'cascade' }),
    tagId:    integer('tag_id').notNull().references(() => tags.id),
    tagType:  text('tag_type', { enum: ['reg', 'time_19', 'time_15'] }).notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => ({
    uniq:       uniqueIndex('funnel_tags_funnel_tag_type_unique').on(t.funnelId, t.tagId, t.tagType),
    funnelIdx:  index('idx_funnel_tags_funnel').on(t.funnelId),
    tagIdx:     index('idx_funnel_tags_tag').on(t.tagId),
  }),
);

// ─── funnel_days (read-only in Phase 1) ──────────────────────────────────────

export const funnelDays = sqliteTable(
  'funnel_days',
  {
    id:          integer('id').primaryKey({ autoIncrement: true }),
    funnelId:    integer('funnel_id').notNull().references(() => funnels.id, { onDelete: 'cascade' }),
    timeSlot:    text('time_slot', { enum: ['19', '15'] }).notNull(),
    dayNum:      integer('day_num').notNull(),
    roomIdF1:    text('room_id_f1').default(''),
    gcRoom:      text('gc_room').default(''),
    webRoom:     text('web_room').default(''),
    replayUrl:   text('replay_url').default(''),
    webReplay:   text('web_replay').default(''),
    salesPage:   text('sales_page').default(''),
    salesNote:   text('sales_note').default(''),
    tariffs:     text('tariffs').default(''),
    oto:         text('oto').default(''),
    bonuses:     text('bonuses').default(''),
    mission:     text('mission').default(''),
    missionType: text('mission_type').default(''),
    meditation:  text('meditation').default(''),
    dojimNote:   text('dojim_note').default(''),
  },
  (t) => ({
    uniq:      uniqueIndex('funnel_days_funnel_slot_day_unique').on(t.funnelId, t.timeSlot, t.dayNum),
    funnelIdx: index('idx_funnel_days_funnel').on(t.funnelId),
  }),
);

// ─── salebot_configs ─────────────────────────────────────────────────────────

export const salebotConfigs = sqliteTable(
  'salebot_configs',
  {
    id:         integer('id').primaryKey({ autoIncrement: true }),
    funnelId:   integer('funnel_id').notNull().references(() => funnels.id, { onDelete: 'cascade' }),
    timeSlot:   text('time_slot', { enum: ['19', '15'] }).notNull(),
    condition:  text('condition').default(''),
    calculator: text('calculator').default(''),
  },
  (t) => ({
    uniq:      uniqueIndex('salebot_configs_funnel_slot_unique').on(t.funnelId, t.timeSlot),
    funnelIdx: index('idx_salebot_funnel').on(t.funnelId),
  }),
);

// ─── product_durations ────────────────────────────────────────────────────────

export const productDurations = sqliteTable(
  'product_durations',
  {
    id:              integer('id').primaryKey({ autoIncrement: true }),
    productId:       integer('product_id').notNull().references(() => products.id),
    dayNum:          integer('day_num').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
  },
  (t) => ({
    uniq: uniqueIndex('product_durations_product_day_unique').on(t.productId, t.dayNum),
  }),
);

// ─── Type exports ─────────────────────────────────────────────────────────────

export type Source           = typeof sources.$inferSelect;
export type Tag              = typeof tags.$inferSelect;
export type Product          = typeof products.$inferSelect;
export type Contractor       = typeof contractors.$inferSelect;
export type Funnel           = typeof funnels.$inferSelect;
export type FunnelTag        = typeof funnelTags.$inferSelect;
export type FunnelDay        = typeof funnelDays.$inferSelect;
export type SalebotConfig    = typeof salebotConfigs.$inferSelect;
export type ProductDuration  = typeof productDurations.$inferSelect;

export type NewFunnel        = typeof funnels.$inferInsert;
