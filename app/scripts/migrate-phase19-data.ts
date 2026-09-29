/**
 * Константы фазы 19, отдельным файлом по общему укладу фаз: и сама фаза, и
 * тесты берут их отсюда.
 *
 * `web_replay` в списке, хотя в живой базе колонка есть с первого импорта
 * (её заводит `tools/data-import/ksamata_funnels_db.py`): база, собранная не
 * этим скриптом, её может не иметь, а приложение с этой фазы её читает.
 */
export const PHASE19_COLUMNS = [
  { name: 'web_replay',   ddl: "ALTER TABLE funnel_days ADD COLUMN web_replay TEXT DEFAULT ''" },
  { name: 'replay_time',  ddl: "ALTER TABLE funnel_days ADD COLUMN replay_time TEXT DEFAULT ''" },
  { name: 'replay2_url',  ddl: "ALTER TABLE funnel_days ADD COLUMN replay2_url TEXT DEFAULT ''" },
  { name: 'web_replay2',  ddl: "ALTER TABLE funnel_days ADD COLUMN web_replay2 TEXT DEFAULT ''" },
  { name: 'replay2_time', ddl: "ALTER TABLE funnel_days ADD COLUMN replay2_time TEXT DEFAULT ''" },
] as const;
