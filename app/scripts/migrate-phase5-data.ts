/**
 * Shared DDL + template seed for Phase-5 (flexible AV-tags).
 * Single source of truth for migrate-phase5.ts (tsx/tests) and the Docker runner.
 *
 * Маркер типа воронки («АВ Автоворонка» и три альтернативы) в шаблоне НЕ живёт
 * с фазы 8: он выводится из funnels.funnel_type_id как пятая ось, см.
 * src/lib/funnel-type.ts. Вернуть его сюда — значит снова поставить один и тот
 * же маркер каждой воронке и получить второй источник правды.
 */

/**
 * `predspisok` в обоих CHECK — для СВЕЖЕЙ базы. На уже промигрированной эта
 * правка не делает ничего: DDL здесь весь `CREATE TABLE IF NOT EXISTS`, а
 * SQLite не умеет ALTER для CHECK. Существующие базы расширяет фаза 14
 * перестройкой таблиц; на свежей она застаёт всё готовым и только ставит свой
 * маркер, чтобы не задвоить строку шаблона.
 */
export const PHASE5_DDL = `
CREATE TABLE IF NOT EXISTS tag_templates (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario TEXT    NOT NULL CHECK(scenario IN ('reg','time_15','time_19','messenger','predspisok')),
  name     TEXT    NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tag_templates_scenario ON tag_templates(scenario);

CREATE TABLE IF NOT EXISTS funnel_tag_overrides (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  funnel_id INTEGER NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  tag_type  TEXT    NOT NULL CHECK(tag_type IN ('reg','time_15','time_19','messenger','predspisok')),
  name      TEXT    NOT NULL,
  op        TEXT    NOT NULL CHECK(op IN ('add','remove')),
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS funnel_tag_overrides_unique
  ON funnel_tag_overrides(funnel_id, tag_type, name);
CREATE INDEX IF NOT EXISTS idx_fto_funnel ON funnel_tag_overrides(funnel_id);
`;

/**
 * Template seed — mirrors the previously hardcoded COMMON_TAGS + stage + time tags.
 *
 * Легаси-тег `автоворонки` стоит ТОЛЬКО на оплатах, и это не упущение.
 * Решение владельца 2026-07-28: тег живой и нужен именно там — на нём настроены
 * дашборды внутри GetCourse и с ним исторически работает отдел продаж. Реестр
 * подтверждает: из 2022 предложений этапа «Оплата» его несут 2005, а из 113
 * регистраций — 2, из 139 мессенджеров — ни одного (там стоит `АВ Автоворонка`).
 * Пока сид требовал его во всех четырёх сценариях, класс 1 отчёта аудита давал
 * крупнейшую строку карты: «база ожидает тег автоворонки на 72 парах».
 */
export const PHASE5_TEMPLATE_SEED: { scenario: string; name: string; position: number }[] = [
  { scenario: 'reg',       name: 'АВ Этап: Регистрация', position: 0 },

  { scenario: 'time_15',   name: 'автоворонки',        position: 0 },
  { scenario: 'time_15',   name: 'АВ Этап: Оплата',    position: 1 },
  { scenario: 'time_15',   name: 'АВ Время: 15',       position: 2 },

  { scenario: 'time_19',   name: 'автоворонки',        position: 0 },
  { scenario: 'time_19',   name: 'АВ Этап: Оплата',    position: 1 },
  { scenario: 'time_19',   name: 'АВ Время: 19',       position: 2 },

  { scenario: 'messenger', name: 'АВ Этап: Мессенджер', position: 0 },

  // Пятый сценарий, заведён фазой 14 (2026-08-25). Написание тега — «Предписок»,
  // без «с»: так этап называется в живом реестре GetCourse. См.
  // PHASE14_STAGE_TAG в migrate-phase14-data.ts.
  { scenario: 'predspisok', name: 'АВ Этап: Предписок', position: 0 },
];

/**
 * Seed tag_templates ONCE per DB, gated by a schema_migrations marker so a
 * second run never double-inserts (there is no natural UNIQUE key on the row).
 */
export function seedTagTemplates(sqlite: import('better-sqlite3').Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)`);
  const done = sqlite.prepare(`SELECT 1 FROM schema_migrations WHERE name='phase5_template_seed'`).get();
  if (done) return;
  const insert = sqlite.prepare(`INSERT INTO tag_templates (scenario, name, position) VALUES (?, ?, ?)`);
  const tx = sqlite.transaction(() => {
    for (const r of PHASE5_TEMPLATE_SEED) insert.run(r.scenario, r.name, r.position);
    sqlite.prepare(`INSERT INTO schema_migrations (name) VALUES ('phase5_template_seed')`).run();
  });
  tx();
}
