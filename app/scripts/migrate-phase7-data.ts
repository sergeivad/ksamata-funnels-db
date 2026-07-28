/**
 * DDL Phase-7 (уникальность F-кода воронки).
 * Единый источник правды для migrate-phase7.ts (tsx/тесты) и Docker-раннера.
 */

/**
 * Нормализация перед индексом. Индекс сравнивает TEXT побайтно, поэтому «F80»
 * и « f80 » прошли бы мимо дубликата — приводим их к канону один раз, здесь же.
 * Приложение делает то же самое на каждой записи (см. lib/front-code.ts), эта
 * строка чинит то, что успело попасть в базу раньше.
 */
export const PHASE7_NORMALIZE = `
UPDATE funnels
   SET front_code = lower(trim(front_code))
 WHERE front_code IS NOT NULL
   AND front_code <> lower(trim(front_code));
`;

/**
 * Индекс частичный: «кода нет» — законное состояние (у десятка воронок в живой
 * базе его нет, и придумывать его нельзя — коды выдаёт ЛИК). Обычный UNIQUE
 * запретил бы вторую пустую строку и миграция упала бы на первой же базе.
 * NULL в уникальных индексах SQLite и так не конфликтуют, но условие оставлено
 * явным: колонка nullable, и читать индекс должно быть можно без этой сноски.
 */
export const PHASE7_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_funnels_front_code_unique
  ON funnels(front_code)
  WHERE front_code IS NOT NULL AND front_code <> '';
`;
