/**
 * Ссылка на карточку собиралась руками в пяти местах — FunnelCard, AppHeader,
 * MonitorTable (дважды) и page.tsx. Ровно поэтому она и разъезжалась: сменив
 * канон адреса, нужно было вспомнить про все пять.
 *
 * Тест падает, если `/funnels/` с подстановкой снова появится где-то, кроме
 * `front-code.ts`. Статический текст (например `<Code>/funnels/78</Code>` в
 * справке) и регулярки в `auth.ts` не ловятся: там нет ни интерполяции, ни
 * конкатенации, а значит и разъезжаться нечему.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const ALLOWED = 'lib/front-code.ts';

// Динамическая сборка адреса: `/funnels/${…}` или '/funnels/' + …
const OFFENDERS = [/\/funnels\/\$\{/, /['"`]\/funnels\/['"`]\s*\+/];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('ссылка на карточку строится только в front-code.ts', () => {
  it('нигде в src/ нет собранного руками /funnels/<подстановка>', () => {
    const guilty: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      if (rel === ALLOWED) continue;
      const text = readFileSync(file, 'utf8');
      if (OFFENDERS.some((re) => re.test(text))) guilty.push(rel);
    }
    expect(guilty, `собери адрес через funnelHref: ${guilty.join(', ')}`).toEqual([]);
  });

  it('сторож не бутафория — он ловит собранный руками адрес', () => {
    expect(OFFENDERS.some((re) => re.test('href={`/funnels/${funnel.id}`}'))).toBe(true);
    expect(OFFENDERS.some((re) => re.test("router.push('/funnels/' + id)"))).toBe(true);
    expect(OFFENDERS.some((re) => re.test('<Code>/funnels/78</Code>'))).toBe(false);
  });
});
