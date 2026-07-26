/**
 * Открытие БД. Пустая база — всегда ошибка: приложение схему не создаёт, её
 * накатывают миграции, поэтому «файла нет» должно падать, а не тихо заводить
 * пустышку, по которой потом ничего не найдётся.
 *
 * Ошибку ловим вручную, а не через expect(...).rejects: при неудаче vitest
 * сериализует значение промиса, а это модуль с drizzle-хендлом — сериализация
 * уводит процесс в OOM и падает весь прогон, а не один тест.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const missing = path.join(os.tmpdir(), `db-client-missing-${Date.now()}.db`);
const savedEnv = process.env.FUNNELS_DB_PATH;

async function importClientError(): Promise<unknown> {
  try {
    await import('../src/db/client');
    return null;
  } catch (e) {
    return e;
  }
}

beforeEach(() => {
  vi.resetModules();
  delete globalThis.__ksamataFunnelsDb;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.FUNNELS_DB_PATH;
  else process.env.FUNNELS_DB_PATH = savedEnv;
  fs.rmSync(missing, { force: true });
  delete globalThis.__ksamataFunnelsDb;
});

describe('db/client', () => {
  it('падает по несуществующему FUNNELS_DB_PATH, а не создаёт пустую БД', async () => {
    process.env.FUNNELS_DB_PATH = missing;

    const err = await importClientError();

    expect(err instanceof Error).toBe(true);
    expect(String((err as Error).message)).toMatch(/not found/i);
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('открывает существующую БД по FUNNELS_DB_PATH', async () => {
    const tmp = path.join(os.tmpdir(), `db-client-ok-${Date.now()}.db`);
    fs.copyFileSync(path.resolve(process.cwd(), '..', 'ksamata_funnels.db'), tmp);
    process.env.FUNNELS_DB_PATH = tmp;

    const err = await importClientError();

    expect(err).toBe(null);
    fs.rmSync(tmp, { force: true });
  });
});
