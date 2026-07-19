import { describe, it, expect } from 'vitest';
import { buildGrid, cellsFromGrid, gridKey } from '../src/lib/rooms-grid';
import type { DayCell } from '../src/lib/funnel-days';

const days: DayCell[] = [
  { timeSlot: '15', dayNum: 1, gcRoom: 'https://gc.ksamata.ru/1dbo', webRoom: 'https://web.x/room/1dbo', replayUrl: 'https://gc.ksamata.ru/1dbo-p' },
  { timeSlot: '19', dayNum: 2, gcRoom: 'https://gc.ksamata.ru/2dbo-19', webRoom: '', replayUrl: 'https://gc.ksamata.ru/2dbo-19-p' },
];

describe('buildGrid', () => {
  it('places cells by slot/day and defaults the rest to empty strings', () => {
    const g = buildGrid(days, 3);
    expect(g[gridKey('15', 1)]).toEqual({ gcRoom: 'https://gc.ksamata.ru/1dbo', webRoom: 'https://web.x/room/1dbo', replayUrl: 'https://gc.ksamata.ru/1dbo-p' });
    expect(g[gridKey('19', 2)].replayUrl).toBe('https://gc.ksamata.ru/2dbo-19-p');
    expect(g[gridKey('19', 3)]).toEqual({ gcRoom: '', webRoom: '', replayUrl: '' });
  });
});

describe('cellsFromGrid', () => {
  it('always preserves replayUrl — the «повтор» toggle must not erase saved replay links', () => {
    const g = buildGrid(days, 2);
    const cells = cellsFromGrid(g, 2);
    const c15d1 = cells.find((c) => c.timeSlot === '15' && c.dayNum === 1)!;
    const c19d2 = cells.find((c) => c.timeSlot === '19' && c.dayNum === 2)!;
    expect(c15d1.replayUrl).toBe('https://gc.ksamata.ru/1dbo-p');
    expect(c19d2.replayUrl).toBe('https://gc.ksamata.ru/2dbo-19-p');
  });

  it('round-trips buildGrid → cellsFromGrid losslessly', () => {
    const g = buildGrid(days, 2);
    const cells = cellsFromGrid(g, 2);
    expect(buildGrid(cells, 2)).toEqual(g);
  });

  it('emits both slots for every day up to dayCount', () => {
    const cells = cellsFromGrid(buildGrid([], 3), 3);
    expect(cells).toHaveLength(6);
    expect(cells.every((c) => c.gcRoom === '' && c.webRoom === '' && c.replayUrl === '')).toBe(true);
  });
});
