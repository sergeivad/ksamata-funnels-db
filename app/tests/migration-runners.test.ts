/**
 * Раннер миграции — единственная точка входа своего бандла.
 *
 * Docker собирает `scripts/*-runner.ts` через esbuild в один .cjs. Внутри
 * бандла `require.main === module` истинно, поэтому CLI-блок ЛЮБОГО файла,
 * попавшего в сборку, срабатывает на импорте — и тело миграции выполняется
 * дважды за старт контейнера: один раз из чужого CLI-блока, второй раз из
 * самого раннера. Так было с фазы 3 до 2026-08-04 и сходило с рук только
 * потому, что все фазы идемпотентны; фаза, которая что-то добавляет или
 * выделяет номер, испортила бы данные на первом же старте.
 *
 * Проверяем именно это: обходим импорты каждого раннера и убеждаемся, что
 * ни в одном достижимом файле нет самозапуска. Тест структурный, потому что
 * настоящая сборка esbuild'ом в CI недоступна — esbuild ставится только в
 * Docker-стадии, в devDependencies его нет.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

const SCRIPTS = join(__dirname, '../scripts');

/**
 * Самозапуск ищем в коде, а не в тексте: файлы, у которых CLI-блок убран,
 * объясняют это в шапке — и строка `require.main === module` там осталась,
 * уже как комментарий. Ищем именно оператор в незакомментированной строке.
 */
function hasSelfRun(file: string): boolean {
  return readFileSync(file, 'utf8')
    .split('\n')
    .some((line) => {
      const code = line.trim();
      if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return false;
      return /if\s*\(\s*require\.main\s*===\s*module\s*\)/.test(code);
    });
}

/** Относительные импорты файла — то, что esbuild втянет в бандл. */
function localImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs = [...src.matchAll(/from\s+'(\.[^']+)'|require\('(\.[^']+)'\)/g)].map(
    (m) => m[1] ?? m[2]
  );
  const out: string[] = [];
  for (const spec of specs) {
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const candidate = resolve(dirname(file), spec + ext);
      if (existsSync(candidate)) {
        out.push(candidate);
        break;
      }
    }
  }
  return out;
}

function bundleFiles(entry: string): string[] {
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    for (const dep of localImports(queue.pop() as string)) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      queue.push(dep);
    }
  }
  return [...seen];
}

const runners = readdirSync(SCRIPTS)
  .filter((f) => f.endsWith('-runner.ts'))
  .map((f) => join(SCRIPTS, f));

describe('Docker-бандлы миграций', () => {
  it('раннеры вообще есть — иначе тест молча ничего не проверяет', () => {
    expect(runners.length).toBeGreaterThan(5);
  });

  it.each(runners.map((r) => [r.split('/').pop() as string, r]))(
    '%s: ни один файл бандла не запускает себя сам',
    (_name, entry) => {
      const selfRunning = bundleFiles(entry)
        .filter(hasSelfRun)
        .map((f) => f.split('/').pop());
      expect(selfRunning).toEqual([]);
    }
  );

  it('сам обход импортов работает — на файле с CLI-блоком он его находит', () => {
    // seed-phase1.ts в бандлы не попадает и CLI-блок сохраняет законно:
    // это ручной скрипт. Здесь он — фикстура, доказывающая, что регрессию
    // тест бы увидел, а не просто всегда возвращает пустой список.
    const manual = join(SCRIPTS, 'seed-phase1.ts');
    expect(hasSelfRun(manual)).toBe(true);
  });
});
