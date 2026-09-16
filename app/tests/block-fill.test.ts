import { describe, it, expect } from 'vitest';
import {
  parsePastedLine,
  mirrorSlotUrl,
  mirrorSlotItems,
  countVerbatimRows,
  missingStandardLabels,
  formatBlockLinks,
  STANDARD_LINKS_LABELS,
  PREDSPISOK_LINK_LABEL,
} from '../src/lib/block-fill';
import type { BlockItem } from '../src/lib/funnel-blocks';

describe('parsePastedLine', () => {
  it('parses a url-only line', () => {
    expect(parsePastedLine('https://example.com/tarif-15-yanr')).toEqual({
      label: '',
      url: 'https://example.com/tarif-15-yanr',
    });
  });

  it('parses "label — url"', () => {
    expect(parsePastedLine('Тариф базовый — https://example.com/tarif')).toEqual({
      label: 'Тариф базовый',
      url: 'https://example.com/tarif',
    });
  });

  it('parses "label\\turl" (tab separated)', () => {
    expect(parsePastedLine('Тариф базовый\thttps://example.com/tarif')).toEqual({
      label: 'Тариф базовый',
      url: 'https://example.com/tarif',
    });
  });

  it('parses "label: url"', () => {
    expect(parsePastedLine('Тариф базовый: https://example.com/tarif')).toEqual({
      label: 'Тариф базовый',
      url: 'https://example.com/tarif',
    });
  });

  it('keeps the whole line as url when there is no url', () => {
    expect(parsePastedLine('просто текст без ссылки')).toEqual({
      label: '',
      url: 'просто текст без ссылки',
    });
  });

  it('handles an empty line', () => {
    expect(parsePastedLine('')).toEqual({ label: '', url: '' });
  });
});

describe('mirrorSlotUrl', () => {
  it('mirrors tarif-15-yanr to tarif-19-yanr', () => {
    expect(mirrorSlotUrl('tarif-15-yanr')).toBe('tarif-19-yanr');
  });

  it('mirrors tarifz-15-yanr to tarifz-19-yanr', () => {
    expect(mirrorSlotUrl('tarifz-15-yanr')).toBe('tarifz-19-yanr');
  });

  it('mirrors oto-15-yanr to oto-19-yanr', () => {
    expect(mirrorSlotUrl('oto-15-yanr')).toBe('oto-19-yanr');
  });

  it('mirrors "Регистрации 15:00" to "Регистрации 19:00"', () => {
    expect(mirrorSlotUrl('Регистрации 15:00')).toBe('Регистрации 19:00');
  });

  it('leaves ids containing 15 as a substring untouched', () => {
    expect(mirrorSlotUrl('id=1534353')).toBe('id=1534353');
  });

  it('leaves a url without 15 untouched', () => {
    expect(mirrorSlotUrl('https://example.com/tarif-yanr')).toBe('https://example.com/tarif-yanr');
  });

  it('mirrors a trailing /15', () => {
    expect(mirrorSlotUrl('https://example.com/15')).toBe('https://example.com/19');
  });

  // Граница токена — «не цифра», а не «разделитель»: то же правило, что у
  // mirrorDayUrl в room-urls.ts. Замер по 251 живой строке колонки 15:00 —
  // +9 верных строк, 0 регрессий.
  it('mirrors 15 glued to a letter (br_mdyo15)', () => {
    expect(mirrorSlotUrl('https://gc.ksamata.ru/dbo/br_mdyo15')).toBe('https://gc.ksamata.ru/dbo/br_mdyo19');
  });
});

describe('mirrorSlotItems', () => {
  it('appends a mirrored 19:00 row for every 15:00 row', () => {
    const items: BlockItem[] = [{ slot: '15', label: 'Тариф 15:00', url: 'https://e.example/tarif-15-yo' }];
    const res = mirrorSlotItems(items);
    expect(res.items).toEqual([
      items[0],
      { slot: '19', label: 'Тариф 19:00', url: 'https://e.example/tarif-19-yo' },
    ]);
    expect(res.verbatim).toEqual([]);
  });

  it('reports a url copied verbatim because it carries no 15 token', () => {
    const items: BlockItem[] = [{ slot: '15', label: '', url: 'https://t.ksamata.ru/dbo/tarif-yo1' }];
    const res = mirrorSlotItems(items);
    expect(res.items[1]).toEqual({ slot: '19', label: '', url: 'https://t.ksamata.ru/dbo/tarif-yo1' });
    expect(res.verbatim).toEqual(['https://t.ksamata.ru/dbo/tarif-yo1']);
  });

  it('does not report a row whose url is empty', () => {
    const items: BlockItem[] = [{ slot: '15', label: 'Пусто', url: '' }];
    expect(mirrorSlotItems(items).verbatim).toEqual([]);
  });

  it('leaves rows of other slots alone', () => {
    const items: BlockItem[] = [
      { slot: null, label: '', url: 'https://e.example/common' },
      { slot: '15', label: '', url: 'https://e.example/a-15' },
    ];
    const res = mirrorSlotItems(items);
    expect(res.items).toHaveLength(3);
    expect(res.items[0]).toEqual(items[0]);
  });
});

describe('countVerbatimRows', () => {
  // Сводка над колонкой и пометка на строке считаются ОДНОЙ функцией: иначе
  // они разъезжаются — строка чинится правкой адреса, а счётчик остаётся
  // висеть от момента нажатия кнопки.
  it('counts the 19:00 rows still holding a verbatim url', () => {
    const items: BlockItem[] = [
      { slot: '15', label: '', url: 'https://e.example/a' },
      { slot: '19', label: '', url: 'https://e.example/a' },
    ];
    expect(countVerbatimRows(items, new Set(['https://e.example/a']))).toBe(1);
  });

  it('stops counting a row once its url was edited', () => {
    const items: BlockItem[] = [
      { slot: '15', label: '', url: 'https://e.example/a' },
      { slot: '19', label: '', url: 'https://e.example/b' },
    ];
    expect(countVerbatimRows(items, new Set(['https://e.example/a']))).toBe(0);
  });

  it('never counts the 15:00 source row itself', () => {
    const items: BlockItem[] = [{ slot: '15', label: '', url: 'https://e.example/a' }];
    expect(countVerbatimRows(items, new Set(['https://e.example/a']))).toBe(0);
  });

  it('is zero for an empty set', () => {
    const items: BlockItem[] = [{ slot: '19', label: '', url: 'https://e.example/a' }];
    expect(countVerbatimRows(items, new Set())).toBe(0);
  });
});

describe('missingStandardLabels', () => {
  it('returns all labels when none exist', () => {
    expect(missingStandardLabels([])).toEqual(STANDARD_LINKS_LABELS);
  });

  it('excludes labels already present (trim + case-insensitive)', () => {
    const existing = [' дашборд продаж ', 'РЕГИСТРАЦИИ ВСЕГО'];
    expect(missingStandardLabels(existing)).toEqual([
      'Дашборд перелива',
      'Регистрации 15:00',
      'Регистрации 19:00',
      'Регистрации без времени',
    ]);
  });

  it('returns empty array when all labels are present', () => {
    expect(missingStandardLabels(STANDARD_LINKS_LABELS)).toEqual([]);
  });

  // Ссылка на предсписок — 7-я по частоте подпись блока (20 воронок), и 19 из
  // этих 20 несут признак шага. Поэтому она в наборе ровно тогда, когда
  // признак поднят, а не всегда.
  it('adds the predspisok label when the funnel has that step', () => {
    expect(missingStandardLabels([], true)).toEqual([...STANDARD_LINKS_LABELS, PREDSPISOK_LINK_LABEL]);
  });

  it('omits the predspisok label when the funnel has no such step', () => {
    expect(missingStandardLabels([], false)).toEqual(STANDARD_LINKS_LABELS);
  });

  it('excludes the predspisok label when it is already there', () => {
    expect(missingStandardLabels([...STANDARD_LINKS_LABELS, ' предсписок '], true)).toEqual([]);
  });
});

describe('formatBlockLinks', () => {
  it('formats a common-mode block as a flat list', () => {
    const items: BlockItem[] = [
      { slot: null, label: 'Дашборд продаж', url: 'https://a.example' },
      { slot: null, label: '', url: 'https://b.example' },
    ];
    expect(formatBlockLinks(items, 'common', '15:00', '19:00')).toBe(
      'Дашборд продаж — https://a.example\nhttps://b.example',
    );
  });

  it('formats by_time mode with 15:00 / 19:00 sections', () => {
    const items: BlockItem[] = [
      { slot: '15', label: 'Тариф', url: 'https://a15.example' },
      { slot: '19', label: 'Тариф', url: 'https://a19.example' },
    ];
    expect(formatBlockLinks(items, 'by_time', '15:00', '19:00')).toBe(
      '15:00:\nТариф — https://a15.example\n\n19:00:\nТариф — https://a19.example',
    );
  });

  it('skips items with an empty url', () => {
    const items: BlockItem[] = [
      { slot: null, label: 'Пустая', url: '' },
      { slot: null, label: '', url: 'https://a.example' },
    ];
    expect(formatBlockLinks(items, 'common', '15:00', '19:00')).toBe('https://a.example');
  });

  it('uses "label — url" when label is non-empty', () => {
    const items: BlockItem[] = [{ slot: null, label: 'Ссылка', url: 'https://a.example' }];
    expect(formatBlockLinks(items, 'common', '15:00', '19:00')).toBe('Ссылка — https://a.example');
  });
});
