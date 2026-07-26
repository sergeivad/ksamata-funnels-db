/**
 * Фикстура тестов — копия реальной БД. Обычный copyFileSync копирует только
 * главный файл: свежие записи, живущие в `*.db-wal` (а дев-сервер держит их
 * там постоянно), в копию не попадают, и тест видит устаревший снимок.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { copyDbForTest } from './helpers/db';

/** БД с незачекпоинченным WAL — ровно то, что оставляет работающий дев-сервер. */
function dbWithPendingWal() {
  const dir = mkdtempSync(join(tmpdir(), 'db-copy-'));
  const src = join(dir, 'source.db');
  const sqlite = new Database(src);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec('CREATE TABLE t (v TEXT)');
  sqlite.prepare('INSERT INTO t (v) VALUES (?)').run('свежая запись');
  // Соединение НЕ закрываем: закрытие сделало бы чекпоинт и спрятало дефект.
  return { dir, src, sqlite };
}

describe('копирование БД для тестов', () => {
  it('переносит записи, застрявшие в WAL', () => {
    const { dir, src, sqlite } = dbWithPendingWal();
    const dest = join(dir, 'copy.db');

    copyDbForTest(src, dest);
    const copied = new Database(dest, { readonly: true });
    expect(copied.prepare('SELECT v FROM t').all()).toEqual([{ v: 'свежая запись' }]);

    copied.close();
    sqlite.close();
  });

  it('демонстрирует, почему copyFileSync недостаточно', () => {
    const { dir, src, sqlite } = dbWithPendingWal();
    const naive = join(dir, 'naive.db');

    copyFileSync(src, naive);
    const copied = new Database(naive, { readonly: true });
    // Главный файл пуст настолько, что в нём нет даже схемы: и CREATE TABLE,
    // и INSERT висят в сайдкаре, который copyFileSync не копирует.
    expect(() => copied.prepare('SELECT v FROM t').all()).toThrow(/no such table/);

    copied.close();
    sqlite.close();
  });
});
