/**
 * DDL фазы 12, отдельным файлом по общему укладу фаз: раннер и тест берут
 * определение отсюда, а не повторяют строку у себя.
 */
export const PHASE12_FUNNEL_TYPE_COLUMN = {
  name: 'has_time',
  // NOT NULL DEFAULT 1: у существующих строк время было всегда, и молча снять
  // его миграция не должна. Нули ставит бэкфилл — по списку безвременных
  // маркеров и только в тот прогон, который эту колонку завёл.
  ddl: 'ALTER TABLE funnel_types ADD COLUMN has_time INTEGER NOT NULL DEFAULT 1',
} as const;
