/**
 * Колонка → подпись пункта блока «Ссылки» — одна таблица, но она переписана
 * вручную в четырёх местах: `migrate-phase11.ts` (LINK_COLUMNS),
 * `migrate-funnel-data.ts` (DASHBOARD_COLUMNS, фаза 3, должна быть буквально
 * той же), `tools/data-export/ksamata_funnels_export.py` (LINK_LABELS) и
 * `block-fill.ts` (STANDARD_LINKS_LABELS, шесть из семи — «Предсписок»
 * сознательно не подсказывается в интерфейсе, колонка у всех воронок пуста).
 *
 * Расхождение молчит: переименуй подпись в STANDARD_LINKS_LABELS, не тронув
 * LINK_COLUMNS — и новый пункт блока, вставленный кнопкой «стандартный
 * набор», перестанет узнаваться экспортом, уходя в «Прочие ссылки» вместо
 * своей графы. Тест сравнивает настоящие значения, а не переписывает их
 * заново — иначе он проверял бы только то, что скопировано правильно.
 *
 * Python-копию (LINK_LABELS) этот файл не видит — за неё отвечает
 * tools/data-export/tests/test_export_links.py, который читает
 * migrate-phase11.ts как текст.
 */
import { describe, it, expect } from 'vitest';
import { LINK_COLUMNS } from '../scripts/migrate-phase11';
import { DASHBOARD_COLUMNS } from '../scripts/migrate-funnel-data';
import { STANDARD_LINKS_LABELS } from '../src/lib/block-fill';

describe('таблица «колонка → подпись» не расходится между копиями', () => {
  it('DASHBOARD_COLUMNS (фаза 3) равна LINK_COLUMNS (фаза 11) целиком, включая порядок', () => {
    expect(DASHBOARD_COLUMNS).toEqual(LINK_COLUMNS);
  });

  it('каждая подпись из STANDARD_LINKS_LABELS есть среди подписей LINK_COLUMNS', () => {
    const labels = new Set(LINK_COLUMNS.map((c) => c.label));
    for (const label of STANDARD_LINKS_LABELS) {
      expect(labels.has(label)).toBe(true);
    }
  });
});
