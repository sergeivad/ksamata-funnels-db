import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  index,
  primaryKey,
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
    // Phase 3 columns
    comment:            text('comment').default(''),
    timeLabelA:         text('time_label_a').default('15:00'),
    timeLabelB:         text('time_label_b').default('19:00'),
    roomsReplayEnabled: integer('rooms_replay_enabled').default(0),
    roomsEnabled:       integer('rooms_enabled').default(1),
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
    tagType:  text('tag_type', { enum: ['reg', 'time_19', 'time_15', 'messenger'] }).notNull(),
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

// ─── channels ─────────────────────────────────────────────────────────────────

export const channels = sqliteTable('channels', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

// ─── directions ───────────────────────────────────────────────────────────────

export const directions = sqliteTable('directions', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

// NOTE: the legacy `funnel_links` table (Phase-2) was removed — funnel links are
// now stored as a `links` block in funnel_blocks / funnel_block_items. Existing
// databases may still carry the empty orphan table; it is unused by the app.

// ─── funnel_blocks / funnel_block_items (Phase 3) ────────────────────────────

export const funnelBlocks = sqliteTable(
  'funnel_blocks',
  {
    id:       integer('id').primaryKey({ autoIncrement: true }),
    funnelId: integer('funnel_id').notNull().references(() => funnels.id, { onDelete: 'cascade' }),
    kind:     text('kind').notNull(),
    enabled:  integer('enabled').notNull().default(0),
    mode:     text('mode', { enum: ['common', 'by_time'] }).notNull().default('common'),
  },
  (t) => ({
    uniq:      uniqueIndex('funnel_blocks_funnel_kind_unique').on(t.funnelId, t.kind),
    funnelIdx: index('idx_funnel_blocks_funnel').on(t.funnelId),
  }),
);

export const funnelBlockItems = sqliteTable(
  'funnel_block_items',
  {
    id:       integer('id').primaryKey({ autoIncrement: true }),
    blockId:  integer('block_id').notNull().references(() => funnelBlocks.id, { onDelete: 'cascade' }),
    slot:     text('slot', { enum: ['15', '19'] }),
    label:    text('label').notNull().default(''),
    url:      text('url').notNull().default(''),
    position: integer('position').notNull().default(0),
  },
  (t) => ({
    blockIdx: index('idx_fbi_block').on(t.blockId),
  }),
);

// ─── tag_templates / funnel_tag_overrides (Phase 5) ──────────────────────────

export const tagTemplates = sqliteTable(
  'tag_templates',
  {
    id:       integer('id').primaryKey({ autoIncrement: true }),
    scenario: text('scenario', { enum: ['reg', 'time_15', 'time_19', 'messenger'] }).notNull(),
    name:     text('name').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => ({
    scenarioIdx: index('idx_tag_templates_scenario').on(t.scenario),
  }),
);

export const funnelTagOverrides = sqliteTable(
  'funnel_tag_overrides',
  {
    id:       integer('id').primaryKey({ autoIncrement: true }),
    funnelId: integer('funnel_id').notNull().references(() => funnels.id, { onDelete: 'cascade' }),
    tagType:  text('tag_type', { enum: ['reg', 'time_15', 'time_19', 'messenger'] }).notNull(),
    name:     text('name').notNull(),
    op:       text('op', { enum: ['add', 'remove'] }).notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => ({
    uniq:      uniqueIndex('funnel_tag_overrides_unique').on(t.funnelId, t.tagType, t.name),
    funnelIdx: index('idx_fto_funnel').on(t.funnelId),
  }),
);

// ─── Мониторинг доступности (Phase 6) ────────────────────────────────────────

export const monitorTargets = sqliteTable(
  'monitor_targets',
  {
    id:         integer('id').primaryKey({ autoIncrement: true }),
    url:        text('url').notNull().unique(),
    sourceKind: text('source_kind').notNull(),
    enabled:    integer('enabled').notNull().default(0),
    note:       text('note').notNull().default(''),
    createdAt:  text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt:  text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    enabledIdx: index('idx_monitor_targets_enabled').on(t.enabled),
  }),
);

export const monitorTargetFunnels = sqliteTable(
  'monitor_target_funnels',
  {
    targetId: integer('target_id').notNull().references(() => monitorTargets.id, { onDelete: 'cascade' }),
    funnelId: integer('funnel_id').notNull().references(() => funnels.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk:        primaryKey({ columns: [t.targetId, t.funnelId] }),
    funnelIdx: index('idx_mtf_funnel').on(t.funnelId),
  }),
);

export const monitorState = sqliteTable(
  'monitor_state',
  {
    targetId:            integer('target_id').primaryKey().references(() => monitorTargets.id, { onDelete: 'cascade' }),
    status:              text('status', { enum: ['up', 'slow', 'down', 'unknown'] }).notNull().default('unknown'),
    httpStatus:          integer('http_status'),
    finalUrl:            text('final_url').notNull().default(''),
    error:               text('error').notNull().default(''),
    latencyMs:           integer('latency_ms'),
    checkedAt:           text('checked_at'),
    since:               text('since'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  },
  (t) => ({
    statusIdx: index('idx_monitor_state_status').on(t.status),
  }),
);

export const monitorEvents = sqliteTable(
  'monitor_events',
  {
    id:         integer('id').primaryKey({ autoIncrement: true }),
    targetId:   integer('target_id').notNull().references(() => monitorTargets.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status').notNull(),
    toStatus:   text('to_status').notNull(),
    httpStatus: integer('http_status'),
    error:      text('error').notNull().default(''),
    at:         text('at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => ({
    targetIdx: index('idx_monitor_events_target').on(t.targetId),
    atIdx:     index('idx_monitor_events_at').on(t.at),
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
export type Channel          = typeof channels.$inferSelect;
export type Direction        = typeof directions.$inferSelect;

export type NewFunnel        = typeof funnels.$inferInsert;
export type FunnelBlock     = typeof funnelBlocks.$inferSelect;
export type FunnelBlockItem = typeof funnelBlockItems.$inferSelect;
export type TagTemplate       = typeof tagTemplates.$inferSelect;
export type FunnelTagOverride = typeof funnelTagOverrides.$inferSelect;

export type MonitorTarget       = typeof monitorTargets.$inferSelect;
export type MonitorTargetFunnel = typeof monitorTargetFunnels.$inferSelect;
export type MonitorStateRow     = typeof monitorState.$inferSelect;
export type MonitorEventRow     = typeof monitorEvents.$inferSelect;
