/**
 * Написание тега этапа предсписка живёт в четырёх местах на двух языках, и
 * разъехаться им нельзя.
 *
 * Тег сравнивается с реестром предложений GetCourse посимвольно, поэтому
 * расхождение не падает и не шумит — оно даёт ноль совпадений и читается как
 * «расхождений нет». Ровно так прошёл август 2026: GetCourse исправил свою
 * опечатку («Предписок» → «Предсписок»), а обе константы остались на старом
 * написании, и сверка месяц отвечала «пусто».
 *
 * Здесь проверяется только согласие сторон между собой — что написание
 * совпадает с ЖИВЫМ реестром, ни один тест доказать не может: реестра у него
 * нет. Это делает прогон tools/audit/run_audit.py.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHASE14_SCENARIO, PHASE14_STAGE_TAG } from '../scripts/migrate-phase14-data';
import { PHASE15_NEW_STAGE_TAG, PHASE15_OLD_STAGE_TAG } from '../scripts/migrate-phase15-data';
import { PHASE5_TEMPLATE_SEED } from '../scripts/migrate-phase5-data';

describe('написание тега этапа предсписка', () => {
  it('сид фазы 5 и константа фазы 14 пишут одно и то же', () => {
    const seeded = PHASE5_TEMPLATE_SEED.filter((r) => r.scenario === PHASE14_SCENARIO).map(
      (r) => r.name
    );
    expect(seeded).toEqual([PHASE14_STAGE_TAG]);
  });

  it('фаза 15 ведёт к тому же написанию, что засевает фаза 14', () => {
    expect(PHASE15_NEW_STAGE_TAG).toBe(PHASE14_STAGE_TAG);
    expect(PHASE15_OLD_STAGE_TAG).not.toBe(PHASE15_NEW_STAGE_TAG);
  });

  it('python-сторона (PREDPISOK_STAGE) совпадает с TypeScript-стороной', () => {
    // Инструмент аудита на другом языке, импортировать константу неоткуда —
    // читаем исходник. Строку берём из кода, а не из комментария: комментарии
    // вокруг неё как раз и рассказывают про старое написание.
    const src = readFileSync(join(__dirname, '../../tools/audit/normalize.py'), 'utf8');
    const line = src
      .split('\n')
      .find((l) => l.startsWith('PREDPISOK_STAGE'));
    expect(line, 'PREDPISOK_STAGE не найдена в tools/audit/normalize.py').toBeDefined();
    const value = /^PREDPISOK_STAGE\s*=\s*'([^']*)'/.exec(line as string)?.[1];
    expect(value).toBe(PHASE14_STAGE_TAG);
  });
});
