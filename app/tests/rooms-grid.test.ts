import { describe, it, expect } from 'vitest';
import { appendDay, buildGrid, cellsFromGrid, emptyCell, fillRoomGrid, gridKey, initialDayCount } from '../src/lib/rooms-grid';
import type { DayCell } from '../src/lib/funnel-days';

const days: DayCell[] = [
  { timeSlot: '15', dayNum: 1, gcRoom: 'https://gc.ksamata.ru/1dbo', webRoom: 'https://web.x/room/1dbo', replayUrl: 'https://gc.ksamata.ru/1dbo-p' },
  { timeSlot: '19', dayNum: 2, gcRoom: 'https://gc.ksamata.ru/2dbo-19', webRoom: '', replayUrl: 'https://gc.ksamata.ru/2dbo-19-p' },
];

describe('buildGrid', () => {
  it('places cells by slot/day and defaults the rest to empty strings', () => {
    const g = buildGrid(days, 3);
    expect(g[gridKey('15', 1)]).toEqual({ ...emptyCell(), gcRoom: 'https://gc.ksamata.ru/1dbo', webRoom: 'https://web.x/room/1dbo', replayUrl: 'https://gc.ksamata.ru/1dbo-p' });
    expect(g[gridKey('19', 2)].replayUrl).toBe('https://gc.ksamata.ru/2dbo-19-p');
    expect(g[gridKey('19', 3)]).toEqual(emptyCell());
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
    const f = fillRoomGrid(g, 5);
    expect(f[gridKey('15', 3)].gcRoom).toBe(`${GC}/dbo3-15-vks`);
    expect(f[gridKey('19', 1)].gcRoom).toBe(`${GC}/dbo1-19-vks`);
    expect(f[gridKey('19', 5)].gcRoom).toBe(`${GC}/dbo5-19-vks`);
    expect(f[gridKey('19', 5)].webRoom).toBe(`${WEB}/dbo5-19-vks`);
  });

  it('разворачивает одну GC-комнату семьи B во всю сетку 2×5', () => {
    const g = buildGrid([{ timeSlot: '15', dayNum: 1, gcRoom: `${GC}/1dbo-bookv`, webRoom: '', replayUrl: '' }], 5);
    const f = fillRoomGrid(g, 5);
    expect(f[gridKey('15', 2)].gcRoom).toBe(`${GC}/2dbo-bookv`);
    expect(f[gridKey('19', 1)].gcRoom).toBe(`${GC}/dbo1-bookv`);
    expect(f[gridKey('19', 4)].gcRoom).toBe(`${GC}/dbo4-bookv`);
    expect(f[gridKey('15', 2)].webRoom).toBe(`${WEB}/2dbo-bookv`);
  });

  it('выводит и назад по дням — образцом может быть любая ячейка', () => {
    const g = buildGrid([{ timeSlot: '19', dayNum: 3, gcRoom: `${GC}/dbo3-19-vks`, webRoom: '', replayUrl: '' }], 3);
    const f = fillRoomGrid(g, 3);
    expect(f[gridKey('19', 1)].gcRoom).toBe(`${GC}/dbo1-19-vks`);
    expect(f[gridKey('15', 1)].gcRoom).toBe(`${GC}/dbo1-15-vks`);
  });

  it('не перетирает непустые поля, даже отличающиеся от выводимого', () => {
    const g = buildGrid([
      { timeSlot: '15', dayNum: 1, gcRoom: `${GC}/dbo1-15-vks`, webRoom: '', replayUrl: '' },
      { timeSlot: '15', dayNum: 2, gcRoom: `${GC}/ruchnoy-adres`, webRoom: '', replayUrl: '' },
    ], 2);
    const f = fillRoomGrid(g, 2);
    expect(f[gridKey('15', 2)].gcRoom).toBe(`${GC}/ruchnoy-adres`);
  });

  // С Phase 19 повторы выводит поиск по Бизону (room-check.ts): зеркало дней
  // сочиняло бы повторы и тем дням, у которых их нет.
  it('не достраивает повторы — их находит поиск по Бизону', () => {
    const g = buildGrid([
      { timeSlot: '15', dayNum: 4, gcRoom: `${GC}/4boo-kvspb`, webRoom: '', replayUrl: `${GC}/4rboo-kvspb` },
    ], 5);
    const f = fillRoomGrid(g, 5);
    for (const slot of ['15', '19']) for (let d = 1; d <= 5; d++) {
      const c = f[gridKey(slot, d)];
      expect(c.replay2Url).toBe('');
      expect(c.webReplay).toBe('');
      if (!(slot === '15' && d === 4)) expect(c.replayUrl).toBe('');
    }
    expect(f[gridKey('15', 4)].replayUrl).toBe(`${GC}/4rboo-kvspb`);
  });

  it('gcRoom по-прежнему достраивается назад по дням — правка одностороннего повтора его не задела', () => {
    const g = buildGrid([
      { timeSlot: '15', dayNum: 4, gcRoom: `${GC}/dbo4-15-vks`, webRoom: '', replayUrl: '' },
    ], 5);
    const f = fillRoomGrid(g, 5);
    expect(f[gridKey('15', 1)].gcRoom).toBe(`${GC}/dbo1-15-vks`);
  });

  it('чужой слот пропускает противоречивый день и берёт следующий подходящий', () => {
    const g = buildGrid([
      { timeSlot: '19', dayNum: 1, gcRoom: `${GC}/dbo1-15-vks`, webRoom: '', replayUrl: '' },
      { timeSlot: '19', dayNum: 2, gcRoom: `${GC}/dbo2-19-vks`, webRoom: '', replayUrl: '' },
    ], 2);
    const f = fillRoomGrid(g, 2);
    expect(f[gridKey('15', 1)].gcRoom).toBe(`${GC}/dbo1-15-vks`);
  });

  it('не выходит за dayCount', () => {
    const g = buildGrid([{ timeSlot: '15', dayNum: 1, gcRoom: `${GC}/1dbo-bookv`, webRoom: '', replayUrl: '' }], 3);
    const f = fillRoomGrid(g, 3);
    expect(f[gridKey('15', 3)].gcRoom).toBe(`${GC}/3dbo-bookv`);
    expect(f[gridKey('15', 4)]).toBeUndefined();
  });

  it('оставляет пустым нераспознанный слаг и не размножает его по дням', () => {
    const g = buildGrid([{ timeSlot: '15', dayNum: 1, gcRoom: `${GC}/svs-yakvboo`, webRoom: '', replayUrl: '' }], 2);
    const f = fillRoomGrid(g, 2);
    expect(f[gridKey('19', 1)].gcRoom).toBe(''); // слотового зеркала нет — ни одна семья не подошла
    expect(f[gridKey('15', 2)].gcRoom).toBe(''); // цифры дня в адресе нет — дневного зеркала тоже нет
    expect(f[gridKey('15', 1)].webRoom).toBe(`${WEB}/svs-yakvboo`); // Web из GC работает всегда
  });

  it('идемпотентна: второй вызов ничего не меняет', () => {
    const g = buildGrid([{ timeSlot: '15', dayNum: 1, gcRoom: `${GC}/1dbo-bookv`, webRoom: '', replayUrl: '' }], 5);
    const once = fillRoomGrid(g, 5);
    expect(fillRoomGrid(once, 5)).toEqual(once);
  });

  it('не мутирует исходную сетку', () => {
    const g = buildGrid([{ timeSlot: '15', dayNum: 1, gcRoom: `${GC}/1dbo-bookv`, webRoom: '', replayUrl: '' }], 2);
    const before = JSON.parse(JSON.stringify(g));
    fillRoomGrid(g, 2);
    expect(g).toEqual(before);
  });

  it('на пустой сетке возвращает её же', () => {
    const g = buildGrid([], 3);
    expect(fillRoomGrid(g, 3)).toEqual(g);
  });
});

describe('appendDay', () => {
  // С 29.09.2026 вписывать можно только комнаты, которые есть на Бизоне, —
  // новый день добавляется пустым, заполняет его «Заполнить и проверить».
  it('добавляет пустой день, даже когда есть из чего вывести', () => {
    const g = buildGrid([
      { timeSlot: '15', dayNum: 1, gcRoom: 'https://gc.ksamata.ru/sst1-15-ht', webRoom: 'https://web.ksamatacenter.com/room/sst1-15-ht', replayUrl: '' },
    ], 1);
    const next = appendDay(g, 1);
    expect(next[gridKey('15', 2)]).toEqual(emptyCell());
    expect(next[gridKey('19', 2)]).toEqual(emptyCell());
    expect(next[gridKey('15', 1)]).toEqual(g[gridKey('15', 1)]);
  });
});

describe('initialDayCount', () => {
  const room = (dayNum: number, gcRoom = 'https://gc.ksamata.ru/x') =>
    ({ timeSlot: '15' as const, dayNum, gcRoom, webRoom: '', replayUrl: '' });

  it('пустая сетка открывается сразу на пяти днях', () => {
    expect(initialDayCount([])).toBe(5);
  });

  it('строки без единой ссылки данными не считаются', () => {
    expect(initialDayCount([room(1, ''), room(2, ''), room(3, '')])).toBe(5);
  });

  it('сетка с данными — по своим дням, но не меньше трёх', () => {
    expect(initialDayCount([room(1)])).toBe(3);
    expect(initialDayCount([room(1), room(4)])).toBe(4);
    expect(initialDayCount([room(5)])).toBe(5);
  });

  it('данными считается и один повтор', () => {
    expect(initialDayCount([{ ...room(2, ''), webReplay2: 'https://web.ksamatacenter.com/room/a2rr' }])).toBe(3);
  });
});
