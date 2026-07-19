import { describe, it, expect } from 'vitest';
import {
  parsePastedLine,
  mirrorSlotUrl,
  webRoomFromGc,
  mirrorDayUrl,
  missingStandardLabels,
  formatBlockLinks,
  STANDARD_LINKS_LABELS,
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
});

describe('webRoomFromGc', () => {
  it('derives the web room from a gc room by sharing the slug', () => {
    expect(webRoomFromGc('https://gc.ksamata.ru/1dbo-bookv')).toBe(
      'https://web.ksamatacenter.com/room/1dbo-bookv',
    );
  });

  it('trims whitespace around the gc url', () => {
    expect(webRoomFromGc('  https://gc.ksamata.ru/dih1-15-rsya ')).toBe(
      'https://web.ksamatacenter.com/room/dih1-15-rsya',
    );
  });

  it('rejects multi-segment gc paths (course pages, not rooms)', () => {
    expect(webRoomFromGc('https://gc.ksamata.ru/svs/bonus1')).toBe('');
  });

  it('rejects non-gc hosts and empty values', () => {
    expect(webRoomFromGc('https://t.ksamata.ru/dih/rsya/a')).toBe('');
    expect(webRoomFromGc('https://gc.ksamata.ru/')).toBe('');
    expect(webRoomFromGc('')).toBe('');
  });
});

describe('mirrorDayUrl', () => {
  it('replaces a leading day digit (15:00 style)', () => {
    expect(mirrorDayUrl('https://gc.ksamata.ru/1dbo-bookv', 1, 3)).toBe('https://gc.ksamata.ru/3dbo-bookv');
  });

  it('replaces a trailing day digit (19:00 style)', () => {
    expect(mirrorDayUrl('https://gc.ksamata.ru/dbo1-bookv', 1, 5)).toBe('https://gc.ksamata.ru/dbo5-bookv');
  });

  it('keeps the 15/19 time tokens intact', () => {
    expect(mirrorDayUrl('https://gc.ksamata.ru/dih1-15-rsya', 1, 2)).toBe('https://gc.ksamata.ru/dih2-15-rsya');
    expect(mirrorDayUrl('https://gc.ksamata.ru/dih1-19-rsya', 1, 4)).toBe('https://gc.ksamata.ru/dih4-19-rsya');
  });

  it('leaves urls without a standalone day digit untouched', () => {
    expect(mirrorDayUrl('https://gc.ksamata.ru/dbo2-bookv', 1, 3)).toBe('https://gc.ksamata.ru/dbo2-bookv');
    expect(mirrorDayUrl('https://web.ksamatacenter.com/room/svs-15', 1, 2)).toBe(
      'https://web.ksamatacenter.com/room/svs-15',
    );
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
