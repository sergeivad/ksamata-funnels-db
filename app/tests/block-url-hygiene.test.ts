/**
 * Ни одна ссылка в блоках воронок не должна быть такой, какую отказывается
 * принять собственный PUT-роут блоков.
 *
 * Это инвариант, а не сегодняшние данные: адреса меняются каждую неделю, но
 * «сохранённое нельзя сохранить снова» — состояние, в котором база быть не
 * должна никогда. Оно возникает, когда разовый скрипт пишет в блок напрямую
 * через `replaceBlock`, минуя `checkUrlField`. Так уже случалось: скрипт от
 * 2026-08-12 положил 20 адресов с незакодированными скобками
 * (`?uc[segment_id]=…`) в девять воронок, и открыв любую из них в админке,
 * человек упирался в 400 на строку, которой не касался.
 *
 * Класс B (текст вместо ссылки — «сайты», «геткурс») роут пропускает как
 * предупреждение, поэтому и здесь он допустим: такие пометки живут в базе
 * годами и ломать их сохранение нельзя.
 */
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import { checkUrlField } from '../src/lib/url-field';

const dir = mkdtempSync(join(tmpdir(), 'url-hygiene-'));
const dbPath = join(dir, 'test.db');
copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
const sqlite = new Database(dbPath);

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('гигиена ссылок в блоках', () => {
  it('в живой базе нет ссылки, которую PUT-роут блоков отверг бы', () => {
    const rows = sqlite
      .prepare(
        `SELECT coalesce(nullif(f.front_code, ''), '#' || f.id) AS code,
                b.kind AS kind, i.label AS label, i.url AS url
           FROM funnel_block_items i
           JOIN funnel_blocks b ON b.id = i.block_id
           JOIN funnels f ON f.id = b.funnel_id`
      )
      .all() as { code: string; kind: string; label: string; url: string }[];

    // Сама выборка должна что-то находить: пустая база сделала бы тест
    // зелёным навсегда и бессмысленным.
    expect(rows.length).toBeGreaterThan(0);

    const bad = rows
      .filter((r) => checkUrlField(r.url).level === 'error')
      .map((r) => `${r.code} [${r.kind}] «${r.label}»: ${r.url}`);

    expect(bad).toEqual([]);
  });
});
