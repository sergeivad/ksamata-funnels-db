/**
 * DDL Phase-7 (пятая ось: тип воронки).
 * Единый источник правды для migrate-phase7.ts (tsx/тесты) и Docker-раннера.
 */
export const PHASE7_DDL = `
CREATE TABLE IF NOT EXISTS funnel_types (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE
);
`;

export const PHASE7_FUNNEL_COLUMN = {
  name: 'funnel_type_id',
  ddl: `ALTER TABLE funnels ADD COLUMN funnel_type_id INTEGER REFERENCES funnel_types(id)`,
};
