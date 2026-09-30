/**
 * Константы фазы 20, отдельным файлом по общему укладу фаз.
 */

export const PHASE20_COLUMN = {
  name: 'leak_todo',
  // DEFAULT '': пусто значит «воронка заведена в ЛИК полностью». Непустой
  // текст — что именно ещё не заведено; его пишет человек на карточке.
  ddl: "ALTER TABLE funnels ADD COLUMN leak_todo TEXT NOT NULL DEFAULT ''",
} as const;
