import { describe, it, expect } from 'vitest';
import { buildGrid, cellsFromGrid, fillRoomGrid, gridKey } from '../src/lib/rooms-grid';
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

const GC = 'https://gc.ksamata.ru';
const WEB = 'https://web.ksamatacenter.com/room';

describe('fillRoomGrid', () => {
  it('разворачивает одну GC-комнату семьи A во всю сетку 2×5', () => {
    const g = buildGrid([{ timeSlot: '15', dayNum: 1, gcRoom: `${GC}/dbo1-15-vks`, webRoom: '', replayUrl: '' }], 5);
    const f = fillRoomGrid(g, 5, false);
    expect(f[gridKey('15', 3)].gcRoom).toBe(`${GC}/dbo3-15-vks`);
    expect(f[gridKey('19', 1)].gcRoom).toBe(`${GC}/dbo1-19-vks`);
    expect(f[gridKey('19', 5)].gcRoom).toBe(`${GC}/dbo5-19-vks`);
    expect(f[gridKey('19', 5)].webRoom).toBe(`${WEB}/dbo5-19-vks`);
  });

  it('разворачивает одну GC-комнату семьи B во всю сетку 2×5', () => {
    const g = buildGrid([{ timeSlot: '15', dayNum: 1, gcRoom: `${GC}/1dbo-bookv`, webRoom: '', replayUrl: '' }], 5);
    const f = fillRoomGrid(g, 5, false);
    expect(f[gridKey('15', 2)].gcRoom).toBe(`${GC}/2dbo-bookv`);
    expect(f[gridKey('19', 1)].gcRoom).toBe(`${GC}/dbo1-bookv`);
    expect(f[gridKey('19', 4)].gcRoom).toBe(`${GC}/dbo4-bookv`);
    expect(f[gridKey('15', 2)].webRoom).toBe(`${WEB}/2dbo-bookv`);
  });

  it('выводит и назад по дням — образцом может быть любая ячейка', () => {
    const g = buildGrid([{ timeSlot: '19', dayNum: 3, gcRoom: `${GC}/dbo3-19-vks`, webRoom: '', replayUrl: '' }], 3);
    const f = fillRoomGrid(g, 3, false);
    expect(f[gridKey('19', 1)].gcRoom).toBe(`${GC}/dbo1-19-vks`);
    expect(f[gridKey('15', 1)].gcRoom).toBe(`${GC}/dbo1-15-vks`);
  });

  it('не перетирает непустые поля, даже отличающиеся от выводимого', () => {
    const g = buildGrid([
      { timeSlot: '15', dayNum: 1, gcRoom: `${GC}/dbo1-15-vks`, webRoom: '', replayUrl: '' },
      { timeSlot: '15', dayNum: 2, gcRoom: `${GC}/ruchnoy-adres`, webRoom: '', replayUrl: '' },
    ], 2);
    const f = fillRoomGrid(g, 2, false);
    expect(f[gridKey('15', 2)].gcRoom).toBe(`${GC}/ruchnoy-adres`);
  });

  it('достраивает повтор по дням своего слота и не заносит его во второй слот', () => {
    const g = buildGrid([
      { timeSlot: '15', dayNum: 4, gcRoom: `${GC}/4boo-kvspb`, webRoom: '', replayUrl: `${GC}/4rboo-kvspb` },
    ], 5);
    const f = fillRoomGrid(g, 5, true);
    expect(f[gridKey('15', 5)].replayUrl).toBe(`${GC}/5rboo-kvspb`);
    expect(f[gridKey('19', 4)].replayUrl).toBe('');
    expect(f[gridKey('19', 5)].replayUrl).toBe('');
  });

  it('не трогает повтор, когда колонка выключена', () => {
    const g = buildGrid([
      { timeSlot: '15', dayNum: 4, gcRoom: `${GC}/4boo-kvspb`, webRoom: '', replayUrl: `${GC}/4rboo-kvspb` },
    ], 5);
    const f = fillRoomGrid(g, 5, false);
    expect(f[gridKey('15', 5)].replayUrl).toBe('');
    expect(f[gridKey('15', 4)].replayUrl).toBe(`${GC}/4rboo-kvspb`);
  });

  it('не выходит за dayCount', () => {
    const g = buildGrid([{ timeSlot: '15', dayNum: 1, gcRoom: `${GC}/1dbo-bookv`, webRoom: '', replayUrl: '' }], 3);
    const f = fillRoomGrid(g, 3, false);
    expect(f[gridKey('15', 3)].gcRoom).toBe(`${GC}/3dbo-bookv`);
    expect(f[gridKey('15', 4)]).toBeUndefined();
  });

  it('оставляет пустым нераспознанный слаг и не размножает его по дням', () => {
    const g = buildGrid([{ timeSlot: '15', dayNum: 1, gcRoom: `${GC}/svs-yakvboo`, webRoom: '', replayUrl: '' }], 2);
    const f = fillRoomGrid(g, 2, false);
    expect(f[gridKey('19', 1)].gcRoom).toBe(''); // слотового зеркала нет — ни одна семья не подошла
    expect(f[gridKey('15', 2)].gcRoom).toBe(''); // цифры дня в адресе нет — дневного зеркала тоже нет
    expect(f[gridKey('15', 1)].webRoom).toBe(`${WEB}/svs-yakvboo`); // Web из GC работает всегда
  });

  it('идемпотентна: второй вызов ничего не меняет', () => {
    const g = buildGrid([{ timeSlot: '15', dayNum: 1, gcRoom: `${GC}/1dbo-bookv`, webRoom: '', replayUrl: '' }], 5);
    const once = fillRoomGrid(g, 5, true);
    expect(fillRoomGrid(once, 5, true)).toEqual(once);
  });

  it('не мутирует исходную сетку', () => {
    const g = buildGrid([{ timeSlot: '15', dayNum: 1, gcRoom: `${GC}/1dbo-bookv`, webRoom: '', replayUrl: '' }], 2);
    const before = JSON.parse(JSON.stringify(g));
    fillRoomGrid(g, 2, false);
    expect(g).toEqual(before);
  });

  it('на пустой сетке возвращает её же', () => {
    const g = buildGrid([], 3);
    expect(fillRoomGrid(g, 3, true)).toEqual(g);
  });
});
