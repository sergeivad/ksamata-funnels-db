/**
 * Где лежит БД при РУЧНОМ запуске скрипта миграции.
 *
 * Раньше дефолтом было `'../ksamata_funnels.db'` — путь относительно cwd. При
 * запуске не из `app/` он указывал в никуда, better-sqlite3 молча создавал там
 * пустой файл, и фазы 5/6 отрабатывали «успешно»: их DDL — сплошные
 * `CREATE TABLE IF NOT EXISTS`, а FK-ссылки SQLite проверяет только на DML.
 * Оператор видел «migration done», настоящая база оставалась нетронутой, а
 * рядом с репозиторием появлялся мусорный файл с посеянным шаблоном тегов.
 *
 * Поэтому: дефолт резолвится от расположения скрипта (как в Python-инструментах
 * репозитория), а несуществующий файл — это отказ, а не повод его создать.
 * Легитимного сценария «создать базу с нуля» в проекте нет: её всегда кладут
 * заранее — сидом в Docker или из репозитория.
 */
import fs from 'fs';
import path from 'path';

export function resolveCliDbPath(
  env: Record<string, string | undefined> = process.env,
  scriptDir: string = __dirname
): string {
  // Заданный путь — намерение оператора, его резолвим от cwd как обычно.
  // Дефолт же не должен зависеть от того, откуда запустили.
  const dbPath = env.FUNNELS_DB_PATH
    ? path.resolve(env.FUNNELS_DB_PATH)
    : path.resolve(scriptDir, '../../ksamata_funnels.db');

  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `База не найдена: ${dbPath}\n` +
        'Миграция не создаёт базу с нуля — она мигрирует существующую. ' +
        'Проверьте путь или задайте FUNNELS_DB_PATH.'
    );
  }
  return dbPath;
}
