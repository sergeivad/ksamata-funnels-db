/**
 * DDL Phase-8 (пятая ось: тип воронки).
 * Единый источник правды для migrate-phase8.ts (tsx/тесты) и Docker-раннера.
 */
export const PHASE8_DDL = `
CREATE TABLE IF NOT EXISTS funnel_types (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE
);
`;

export const PHASE8_FUNNEL_COLUMN = {
  name: 'funnel_type_id',
  ddl: `ALTER TABLE funnels ADD COLUMN funnel_type_id INTEGER REFERENCES funnel_types(id)`,
};
