/**
 * Повторы (Phase 19): адреса комнаты, страница Бизона, поиск повторов и поле
 * повтора в сетке. Слаги и времена — из замера по Бизону 29.09.2026 (F21
 * «Сосуды», Яндекс): повторы есть в дни 1–4, в пятый — нет; у эфира 15:00
 * повторы в 19:00 и 9:00.
 */
import { describe, it, expect } from 'vitest';
import {
  gcRoomUrl, isRoomSlug, replaySlug, roomSlugFromUrl, webRoomUrl,
} from '../src/lib/room-urls';
import { parseBizonRoomPage } from '../src/lib/bizon-room-page';
import { findReplays, type FetchFn } from '../src/lib/replay-finder';
import {
  buildGrid, commonReplayTime, emptyCell, gridKey, liveInputValue, replayInputValue, withFoundReplay, withLiveLink, withReplayLink,
} from '../src/lib/rooms-grid';

const ALIVE = (ms: number) =>
  `<html><head><title>3й день онлайн-здравницы</title></head><body><script>var closestDate = +'${ms}';</script></body></html>`;
const DEAD = '<html><head><title>Веб-комната не найдена</title></head><body></body></html>';

/** 30.09.2026 19:00 МСК = 16:00 UTC. */
const AT_19_MSK = Date.UTC(2026, 8, 30, 16, 0);
/** 30.09.2026 09:00 МСК = 06:00 UTC. */
const AT_9_MSK = Date.UTC(2026, 8, 30, 6, 0);

describe('адреса комнаты', () => {
  it('вынимает слаг из любого из трёх адресов', () => {
    expect(roomSlugFromUrl('https://gc.ksamata.ru/cvc3r-15-yan')).toBe('cvc3r-15-yan');
    expect(roomSlugFromUrl('https://web.ksamatacenter.com/room/cvc3r-15-yan')).toBe('cvc3r-15-yan');
    expect(roomSlugFromUrl('https://start.bizon365.ru/room/135662/cvc3rr-15-yan')).toBe('cvc3rr-15-yan');
    expect(roomSlugFromUrl('  https://start.bizon365.ru/room/135662/sst4r-19-nr/ ')).toBe('sst4r-19-nr');
  });

  it('не считает комнатой курсовую страницу и чужой хост', () => {
    expect(roomSlugFromUrl('https://gc.ksamata.ru/svs/bonus1')).toBeNull();
    expect(roomSlugFromUrl('https://example.com/room/cvc3r-15-yan')).toBeNull();
    expect(roomSlugFromUrl('сайты')).toBeNull();
  });

  it('собирает адреса GC и Web из слага', () => {
    expect(gcRoomUrl('cvc3r-15-yan')).toBe('https://gc.ksamata.ru/cvc3r-15-yan');
    expect(webRoomUrl('cvc3r-15-yan')).toBe('https://web.ksamatacenter.com/room/cvc3r-15-yan');
  });

  it('слаг комнаты — только буквы, цифры, дефис и подчёркивание', () => {
    expect(isRoomSlug('cvc3r-15-yan')).toBe(true);
    expect(isRoomSlug('../admin')).toBe(false);
    expect(isRoomSlug('a b')).toBe(false);
  });
});

describe('replaySlug', () => {
  it('ставит r и rr после цифры дня', () => {
    expect(replaySlug('cvc3-15-yan', 3, 1)).toBe('cvc3r-15-yan');
    expect(replaySlug('cvc3-15-yan', 3, 2)).toBe('cvc3rr-15-yan');
    expect(replaySlug('boo4-yons', 4, 1)).toBe('boo4r-yons');
    expect(replaySlug('4boo-yons', 4, 2)).toBe('4rrboo-yons');
  });

  it('не принимает единицу из токена времени 15 за день 1', () => {
    expect(replaySlug('cvc1-15-yan', 1, 1)).toBe('cvc1r-15-yan');
    expect(replaySlug('cvc5-15-yan', 1, 1)).toBeNull();
  });
});

describe('страница комнаты Бизона', () => {
  it('несуществующая комната', () => {
    expect(parseBizonRoomPage(DEAD)).toEqual({ exists: false });
  });

  it('время ближайшего показа — по Москве', () => {
    expect(parseBizonRoomPage(ALIVE(AT_19_MSK))).toEqual({ exists: true, time: '19:00' });
    expect(parseBizonRoomPage(ALIVE(AT_9_MSK))).toEqual({ exists: true, time: '9:00' });
  });

  it('комната без запланированных показов есть, но без времени', () => {
    expect(parseBizonRoomPage(ALIVE(0))).toEqual({ exists: true, time: null });
  });
});

/** Бизон понарошку: слаг → страница; отсутствующий в карте слаг — сбой сети. */
function fakeBizon(pages: Record<string, string>): { fetch: FetchFn; asked: string[] } {
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const slug = url.slice(url.lastIndexOf('/') + 1);
    if (!(slug in pages)) throw new Error('network down');
    return new Response(pages[slug], { status: 200 });
  }) as FetchFn;
  return { fetch: fetchImpl, asked };
}

const LIVE = (d: number) => `https://web.ksamatacenter.com/room/cvc${d}-15-yan`;

describe('findReplays', () => {
  it('находит оба повтора со временем и честно говорит, чего нет', async () => {
    const bizon = fakeBizon({
      'cvc4r-15-yan': ALIVE(AT_19_MSK),
      'cvc4rr-15-yan': ALIVE(AT_9_MSK),
      'cvc5r-15-yan': DEAD,
      'cvc5rr-15-yan': DEAD,
    });
    const res = await findReplays([
      { timeSlot: '15', dayNum: 4, liveUrl: LIVE(4), replay1: '', replay2: '' },
      { timeSlot: '15', dayNum: 5, liveUrl: LIVE(5), replay1: '', replay2: '' },
    ], bizon.fetch);
    expect(res).toEqual([
      { timeSlot: '15', dayNum: 4, n: 1, slug: 'cvc4r-15-yan', wasFilled: false, outcome: 'found', time: '19:00' },
      { timeSlot: '15', dayNum: 4, n: 2, slug: 'cvc4rr-15-yan', wasFilled: false, outcome: 'found', time: '9:00' },
      { timeSlot: '15', dayNum: 5, n: 1, slug: 'cvc5r-15-yan', wasFilled: false, outcome: 'missing', time: null },
      { timeSlot: '15', dayNum: 5, n: 2, slug: 'cvc5rr-15-yan', wasFilled: false, outcome: 'missing', time: null },
    ]);
    // Запросы идут только на web.ksamatacenter.com.
    expect(bizon.asked.every((u) => u.startsWith('https://web.ksamatacenter.com/room/'))).toBe(true);
  });

  // Сбой сети — не «повтора нет»: иначе поиск тихо объявил бы мёртвым то,
  // чего просто не дождался.
  it('сбой сети отдаёт error, а не missing', async () => {
    const bizon = fakeBizon({});
    const res = await findReplays([{ timeSlot: '15', dayNum: 4, liveUrl: LIVE(4), replay1: '', replay2: '' }], bizon.fetch);
    expect(res.map((r) => r.outcome)).toEqual(['error', 'error']);
  });

  it('заполненный повтор проверяет по его собственному слагу', async () => {
    const bizon = fakeBizon({ 'svoy-slag': ALIVE(AT_19_MSK), 'cvc4rr-15-yan': ALIVE(AT_9_MSK) });
    const res = await findReplays([{
      timeSlot: '15', dayNum: 4, liveUrl: LIVE(4),
      replay1: 'https://start.bizon365.ru/room/135662/svoy-slag', replay2: '',
    }], bizon.fetch);
    expect(res[0]).toMatchObject({ n: 1, slug: 'svoy-slag', wasFilled: true, outcome: 'found', time: '19:00' });
  });

  it('не комнату в поле повтора и эфир без цифры дня не проверяет', async () => {
    const bizon = fakeBizon({});
    const res = await findReplays([{
      timeSlot: '15', dayNum: 4, liveUrl: 'https://web.ksamatacenter.com/room/svs-yakvboo',
      replay1: 'заметка', replay2: '',
    }], bizon.fetch);
    expect(res.map((r) => r.outcome)).toEqual(['skipped', 'skipped']);
    expect(bizon.asked).toHaveLength(0);
  });

  it('неудачную проверку повторяет один раз', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) throw new Error('timeout');
      return new Response(ALIVE(AT_19_MSK), { status: 200 });
    }) as FetchFn;
    const res = await findReplays([{
      timeSlot: '15', dayNum: 4, liveUrl: LIVE(4),
      replay1: '', replay2: 'не комната',
    }], fetchImpl);
    expect(res[0]).toMatchObject({ outcome: 'found', time: '19:00' });
    expect(calls).toBe(2);
  });

  it('ответ не 200 — неизвестно, а не «нет»', async () => {
    const fetchImpl = (async () => new Response('', { status: 502 })) as FetchFn;
    const res = await findReplays([{ timeSlot: '15', dayNum: 4, liveUrl: LIVE(4), replay1: '', replay2: '' }], fetchImpl);
    expect(res.map((r) => r.outcome)).toEqual(['error', 'error']);
  });
});

describe('поле повтора в сетке', () => {
  it('любой из трёх адресов раскладывается в пару GC + Web', () => {
    const c = withReplayLink(emptyCell(), 2, 'https://start.bizon365.ru/room/135662/cvc3rr-15-yan');
    expect(c.replay2Url).toBe('https://gc.ksamata.ru/cvc3rr-15-yan');
    expect(c.webReplay2).toBe('https://web.ksamatacenter.com/room/cvc3rr-15-yan');
    expect(replayInputValue(c, 2)).toBe('cvc3rr-15-yan');
    // Первый повтор не задет.
    expect(c.replayUrl).toBe('');
  });

  it('не комнатный текст ложится в GC как есть, Web пуст', () => {
    const c = withReplayLink(emptyCell(), 1, 'уточнить у Ани');
    expect(c.replayUrl).toBe('уточнить у Ани');
    expect(c.webReplay).toBe('');
  });

  it('смена комнаты сбрасывает время, та же комната — нет', () => {
    const found = withFoundReplay(emptyCell(), 1, 'cvc3r-15-yan', '19:00');
    expect(found.replayTime).toBe('19:00');
    expect(withReplayLink(found, 1, 'https://gc.ksamata.ru/cvc3r-15-yan').replayTime).toBe('19:00');
    expect(withReplayLink(found, 1, 'https://gc.ksamata.ru/cvc4r-15-yan').replayTime).toBe('');
  });

  it('старый повтор с одним GC показывается в поле', () => {
    const g = buildGrid([{ timeSlot: '15', dayNum: 4, gcRoom: '', webRoom: '', replayUrl: 'https://gc.ksamata.ru/4rboo-kvspb' }], 5);
    expect(replayInputValue(g[gridKey('15', 4)], 1)).toBe('4rboo-kvspb');
  });

  it('в поле можно ввести само название комнаты', () => {
    const c = withReplayLink(emptyCell(), 1, 'cvc3r-15-yan');
    expect(c.replayUrl).toBe('https://gc.ksamata.ru/cvc3r-15-yan');
    expect(c.webReplay).toBe('https://web.ksamatacenter.com/room/cvc3r-15-yan');
  });

  it('общее время колонки — только когда у всех заполненных оно одно', () => {
    let g = buildGrid([], 3);
    g[gridKey('15', 1)] = withFoundReplay(g[gridKey('15', 1)], 1, 'cvc1r-15-yan', '19:00');
    g[gridKey('15', 2)] = withFoundReplay(g[gridKey('15', 2)], 1, 'cvc2r-15-yan', '19:00');
    expect(commonReplayTime(g, '15', 1, 3)).toBe('19:00');
    g = { ...g, [gridKey('15', 3)]: withFoundReplay(g[gridKey('15', 3)], 1, 'cvc3r-15-yan', '20:00') };
    expect(commonReplayTime(g, '15', 1, 3)).toBeNull();
    expect(commonReplayTime(g, '15', 2, 3)).toBeNull();
  });
});

describe('поле эфира в сетке', () => {
  it('любой из трёх адресов или код раскладывается в пару GC + Бизон', () => {
    for (const raw of [
      'https://gc.ksamata.ru/cvc3-15-yan',
      'https://web.ksamatacenter.com/room/cvc3-15-yan',
      'https://start.bizon365.ru/room/135662/cvc3-15-yan',
      'cvc3-15-yan',
    ]) {
      const c = withLiveLink(emptyCell(), raw);
      expect(c.gcRoom).toBe('https://gc.ksamata.ru/cvc3-15-yan');
      expect(c.webRoom).toBe('https://web.ksamatacenter.com/room/cvc3-15-yan');
      expect(liveInputValue(c)).toBe('cvc3-15-yan');
    }
  });

  it('не комнатный текст ложится в GC как есть, Бизон пуст', () => {
    const c = withLiveLink(emptyCell(), 'https://gc.ksamata.ru/svs/bonus1');
    expect(c.gcRoom).toBe('https://gc.ksamata.ru/svs/bonus1');
    expect(c.webRoom).toBe('');
    expect(liveInputValue(c)).toBe('https://gc.ksamata.ru/svs/bonus1');
  });

  it('повторы при правке эфира не трогаются', () => {
    const withReplay = withFoundReplay(emptyCell(), 1, 'cvc3r-15-yan', '19:00');
    const c = withLiveLink(withReplay, 'cvc3-15-yan');
    expect(c.replayUrl).toBe('https://gc.ksamata.ru/cvc3r-15-yan');
    expect(c.replayTime).toBe('19:00');
  });

  it('очистка поля очищает обе ссылки', () => {
    const c = withLiveLink(withLiveLink(emptyCell(), 'cvc3-15-yan'), '');
    expect(c.gcRoom).toBe('');
    expect(c.webRoom).toBe('');
  });
});
