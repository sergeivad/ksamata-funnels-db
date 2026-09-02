/**
 * Seed образа и репозиторная база держат ОДНИ И ТЕ ЖЕ данные.
 *
 * Это не пожелание, а сложившийся уклад: на efbbab6 (перед работами 02.09.2026)
 * дампы обоих файлов совпадали посимвольно, и коммит 0ee4ee8 «база образа
 * обновлена с 20.07 на 28.08» обновлял сид целиком, а не по кусочкам.
 *
 * Сломалось это молча. Коммит переноса выгрузки с прода (8262144) положил
 * воронку f97 и 18 позиций «Предсписок» ТОЛЬКО в репозиторную базу — и ни одна
 * проверка не заметила: фазы 15, 16 и 17 в сид доехали, схема сошлась, обе базы
 * выглядели здоровыми, а разница была видна лишь по счёту воронок.
 *
 * Цена расхождения проявляется в единственный момент и тоже без сообщений:
 * `docker-entrypoint.sh` копирует сид в `/data` при ПЕРВОМ старте контейнера.
 * Прод это не задевает — там база уже лежит, — но образ, поднятый на чистом
 * томе (новая машина, пересозданный volume, локальный прод-стек), сядет на
 * данные без f97, и миграции такого не ловят: расхождений у них нет, просто
 * воронки нет.
 *
 * Сверяем СОДЕРЖАНИЕ, а не дамп целиком: `id` строк съезжают от любой
 * перезаписи блока (`replaceBlock` удаляет и вставляет заново), и равенство
 * дампов ломалось бы на ровном месте. Три множества ниже — то, что переживает
 * перенумерацию и при этом описывает данные полностью.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'node:path';

const REPO_DB = join(__dirname, '../../ksamata_funnels.db');
const SEED_DB = join(__dirname, '../seed/ksamata_funnels.db');

/** Читает множество строк-отпечатков из базы, открытой только на чтение. */
function fingerprints(path: string, sql: string): string[] {
  const db = new Database(path, { readonly: true });
  try {
    return (db.prepare(sql).all() as { v: string }[]).map((r) => r.v).sort();
  } finally {
    db.close();
  }
}

const FUNNELS = `SELECT front_code AS v FROM funnels`;

const BLOCK_ITEMS = `
  SELECT f.front_code || '|' || b.kind || '|' ||
         COALESCE(i.label, '') || '|' || COALESCE(i.url, '') AS v
    FROM funnel_block_items i
    JOIN funnel_blocks b ON b.id = i.block_id
    JOIN funnels f       ON f.id = b.funnel_id`;

const TAGS = `
  SELECT f.front_code || '|' || ft.tag_type || '|' || t.name AS v
    FROM funnel_tags ft
    JOIN funnels f ON f.id = ft.funnel_id
    JOIN tags t    ON t.id = ft.tag_id`;

describe('seed образа и репозиторная база', () => {
  it('содержат одни и те же воронки', () => {
    const repo = fingerprints(REPO_DB, FUNNELS);
    const seed = fingerprints(SEED_DB, FUNNELS);
    // Сообщение важнее равенства: тот, кто увидит падение, должен сразу
    // понять, что чинить — прогнать перенос ещё раз на app/seed/.
    expect(repo.filter((c) => !seed.includes(c)), 'есть в репо, нет в сиде').toEqual([]);
    expect(seed.filter((c) => !repo.includes(c)), 'есть в сиде, нет в репо').toEqual([]);
  });

  it('содержат одни и те же позиции блоков', () => {
    const repo = fingerprints(REPO_DB, BLOCK_ITEMS);
    const seed = fingerprints(SEED_DB, BLOCK_ITEMS);
    expect(repo.filter((v) => !seed.includes(v)).slice(0, 5), 'есть в репо, нет в сиде').toEqual([]);
    expect(seed.filter((v) => !repo.includes(v)).slice(0, 5), 'есть в сиде, нет в репо').toEqual([]);
  });

  it('содержат одни и те же материализованные теги', () => {
    const repo = fingerprints(REPO_DB, TAGS);
    const seed = fingerprints(SEED_DB, TAGS);
    expect(repo.filter((v) => !seed.includes(v)).slice(0, 5), 'есть в репо, нет в сиде').toEqual([]);
    expect(seed.filter((v) => !repo.includes(v)).slice(0, 5), 'есть в сиде, нет в репо').toEqual([]);
  });

  it('в сиде, как и в репозиторной базе, пусты таблицы мониторинга', () => {
    for (const path of [REPO_DB, SEED_DB]) {
      const db = new Database(path, { readonly: true });
      try {
        const { c } = db.prepare('SELECT COUNT(*) AS c FROM monitor_targets').get() as { c: number };
        expect(c, path).toBe(0);
      } finally {
        db.close();
      }
    }
  });
});
