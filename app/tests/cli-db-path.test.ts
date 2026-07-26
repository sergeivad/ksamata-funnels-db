/**
 * Путь к БД для ручного запуска миграций.
 *
 * Дефолт `'../ksamata_funnels.db'` резолвился от cwd: запуск не из app/ уводил
 * миграцию на несуществующий файл, better-sqlite3 молча создавал его, и фазы 5/6
 * (сплошные CREATE TABLE IF NOT EXISTS) рапортовали об успехе, не тронув
 * настоящую базу и оставив рядом с репозиторием мусор с посеянным шаблоном тегов.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { resolveCliDbPath } from '../scripts/cli-db-path';

/** Изображаем app/scripts/ внутри временного «репозитория» с базой в корне. */
function fakeRepo(withDb = true) {
  const root = mkdtempSync(join(tmpdir(), 'cli-db-path-'));
  const scriptDir = join(root, 'app', 'scripts');
  require('fs').mkdirSync(scriptDir, { recursive: true });
  if (withDb) writeFileSync(join(root, 'ksamata_funnels.db'), '');
  return { root, scriptDir };
}

describe('resolveCliDbPath', () => {
  it('находит базу от расположения скрипта, а не от cwd', () => {
    const { root, scriptDir } = fakeRepo();
    expect(resolveCliDbPath({}, scriptDir)).toBe(resolve(root, 'ksamata_funnels.db'));
  });

  it('отказывается открывать несуществующую базу вместо её создания', () => {
    const { scriptDir } = fakeRepo(false);
    expect(() => resolveCliDbPath({}, scriptDir)).toThrow(/не найдена|not found/i);
  });

  it('уважает заданный FUNNELS_DB_PATH', () => {
    const { root, scriptDir } = fakeRepo();
    const explicit = join(root, 'ksamata_funnels.db');
    expect(resolveCliDbPath({ FUNNELS_DB_PATH: explicit }, scriptDir)).toBe(explicit);
  });

  it('отказывается и по заданному пути, если файла там нет', () => {
    const { root, scriptDir } = fakeRepo();
    expect(() => resolveCliDbPath({ FUNNELS_DB_PATH: join(root, 'нет.db') }, scriptDir))
      .toThrow(/не найдена|not found/i);
  });
});
