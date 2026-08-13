import { describe, it, expect } from 'vitest';
import { webRoomFromGc, mirrorDayUrl, mirrorSlotRoomUrl } from '../src/lib/room-urls';

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

describe('mirrorSlotRoomUrl — семья A (токен времени в слаге)', () => {
  it('mirrors 15 → 19', () => {
    expect(mirrorSlotRoomUrl('https://gc.ksamata.ru/dbo1-15-vks', '15')).toBe(
      'https://gc.ksamata.ru/dbo1-19-vks',
    );
  });

  it('mirrors 19 → 15', () => {
    expect(mirrorSlotRoomUrl('https://gc.ksamata.ru/cvc3-19-rsya', '19')).toBe(
      'https://gc.ksamata.ru/cvc3-15-rsya',
    );
  });

  it('works on web room urls too (the slug is the last segment)', () => {
    expect(mirrorSlotRoomUrl('https://web.ksamatacenter.com/room/zkt2-15-nrmp', '15')).toBe(
      'https://web.ksamatacenter.com/room/zkt2-19-nrmp',
    );
  });

  it('leaves day digits alone', () => {
    expect(mirrorSlotRoomUrl('https://gc.ksamata.ru/dbo5-15-ht', '15')).toBe(
      'https://gc.ksamata.ru/dbo5-19-ht',
    );
  });
});

describe('mirrorSlotRoomUrl — семья B (цифра дня переезжает через слово)', () => {
  it('mirrors 15 → 19: 1dbo-bookv → dbo1-bookv', () => {
    expect(mirrorSlotRoomUrl('https://gc.ksamata.ru/1dbo-bookv', '15')).toBe(
      'https://gc.ksamata.ru/dbo1-bookv',
    );
  });

  it('mirrors 19 → 15: dbo1-bookv → 1dbo-bookv', () => {
    expect(mirrorSlotRoomUrl('https://gc.ksamata.ru/dbo1-bookv', '19')).toBe(
      'https://gc.ksamata.ru/1dbo-bookv',
    );
  });

  it('round-trips both ways on a real pair', () => {
    const a = 'https://gc.ksamata.ru/4boo-kvspb';
    const b = 'https://gc.ksamata.ru/boo4-kvspb';
    expect(mirrorSlotRoomUrl(a, '15')).toBe(b);
    expect(mirrorSlotRoomUrl(b, '19')).toBe(a);
  });

  it('works on web room urls too', () => {
    expect(mirrorSlotRoomUrl('https://web.ksamatacenter.com/room/2svs-yakvboo', '15')).toBe(
      'https://web.ksamatacenter.com/room/svs2-yakvboo',
    );
  });
});

describe('mirrorSlotRoomUrl — не выводится', () => {
  it('returns empty for a slug matching neither family', () => {
    expect(mirrorSlotRoomUrl('https://gc.ksamata.ru/svs-yakvboo', '15')).toBe('');
    expect(mirrorSlotRoomUrl('https://gc.ksamata.ru/svs-yakvboo', '19')).toBe('');
  });

  it('returns empty when the slug carries the OTHER slot time token', () => {
    // адрес противоречит ячейке, в которой лежит — выводить из него нельзя
    expect(mirrorSlotRoomUrl('https://gc.ksamata.ru/dbo1-15-vks', '19')).toBe('');
    expect(mirrorSlotRoomUrl('https://gc.ksamata.ru/dbo1-19-vks', '15')).toBe('');
  });

  it('returns empty for a value that is not a url with a slug', () => {
    expect(mirrorSlotRoomUrl('', '15')).toBe('');
    expect(mirrorSlotRoomUrl('просто текст', '15')).toBe('');
    expect(mirrorSlotRoomUrl('https://gc.ksamata.ru/', '15')).toBe('');
  });

  it('rejects a family-B slug whose tail after the peeled word is not a separator', () => {
    // "1dbo2-x": цифра 2 сразу после переставляемого слова — не хвост-разделитель,
    // а часть слага; переставлять её в мусор ("dbo12-x") нельзя.
    expect(mirrorSlotRoomUrl('https://gc.ksamata.ru/1dbo2-x', '15')).toBe('');
    expect(mirrorSlotRoomUrl('https://gc.ksamata.ru/1dbo2-x', '19')).toBe('');
  });

  it('still accepts the real family-B pairs after the boundary fix', () => {
    expect(mirrorSlotRoomUrl('https://gc.ksamata.ru/1dbo-bookv', '15')).toBe(
      'https://gc.ksamata.ru/dbo1-bookv',
    );
    expect(mirrorSlotRoomUrl('https://gc.ksamata.ru/4boo-kvspb', '15')).toBe(
      'https://gc.ksamata.ru/boo4-kvspb',
    );
  });
});
