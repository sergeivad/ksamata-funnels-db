# Достройка сетки комнат — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Кнопка в редакторе комнат достраивает всю сетку (оба времени, все дни, GC + Web) по одной заполненной ячейке.

**Architecture:** Правила адресов комнат выносятся в новый чистый модуль `room-urls.ts`; достройка сетки — чистая функция `fillRoomGrid` в существующем `rooms-grid.ts`; `RoomsEditor` теряет собственную логику заполнения и держит только состояние и разметку. Схема БД, API и формат сохранения не меняются.

**Tech Stack:** TypeScript, React 19 (клиентский компонент), vitest. Команды запускаются из `app/`.

Спека: [docs/superpowers/specs/2026-08-13-rooms-grid-autofill-design.md](../specs/2026-08-13-rooms-grid-autofill-design.md).

## Global Constraints

- Все команды — из каталога `app/`: `npx vitest run`, `npx tsc --noEmit`, `npm run build`.
- Новый код — **чистые функции**: без обращений к БД, без `node:*`, без побочных эффектов. Их импортирует клиентский компонент.
- Заполняются **только пустые** поля. Непустое значение не перетирается никогда, даже если оно отличается от выводимого.
- Повтор (`replayUrl`) выводится **только из своего слота** дневным зеркалом. Из комнаты повтор не выводится, слотовое зеркало к нему не применяется.
- Слаг, не подошедший ни под одну семью, вывода не даёт: функция возвращает `''`, ячейка остаётся пустой, сообщений не показывается.
- Схема БД, миграции и роуты API не трогаются. `ksamata_funnels.db` не изменяется — если запускали dev-сервер, восстановите файл по разделу «Monitoring gotcha» в CLAUDE.md перед коммитом.
- Тексты интерфейса — по-русски. Подпись кнопки: `Заполнить остальные`. Её `title`: `Достроить пустые ячейки по образцу заполненных: другой день, второе время, Web из GC`.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `app/src/lib/room-urls.ts` | **создаётся.** Правила адресов комнат: `webRoomFromGc`, `mirrorDayUrl`, `mirrorSlotRoomUrl`. Ничего не знает о сетке. |
| `app/src/lib/rooms-grid.ts` | дополняется `fillRoomGrid` — достройка сетки. Знает о форме сетки, правила адресов берёт из `room-urls.ts`. |
| `app/src/lib/block-fill.ts` | из него **уезжают** `webRoomFromGc` и `mirrorDayUrl` (они не про блоки ссылок). `mirrorSlotUrl` остаётся — у него другая работа. |
| `app/src/components/RoomsEditor.tsx` | теряет `FILL_FIELDS`, `canFillFromDay1`, `fillFromDay1`; зовёт `fillRoomGrid`. |
| `app/tests/room-urls.test.ts` | **создаётся.** Тесты правил адресов. |
| `app/tests/rooms-grid.test.ts` | дополняется тестами `fillRoomGrid`. |
| `app/tests/block-fill.test.ts` | из него уезжают блоки `webRoomFromGc` и `mirrorDayUrl`. |

---

### Task 1: Модуль правил адресов комнат

Переезд двух существующих функций плюс новое слотовое зеркало. Задача заканчивается зелёными тестами и чистым `tsc` — значит, переезд не сломал `RoomsEditor`.

**Files:**
- Create: `app/src/lib/room-urls.ts`
- Create: `app/tests/room-urls.test.ts`
- Modify: `app/src/lib/block-fill.ts` (удалить `webRoomFromGc`, `mirrorDayUrl` и константу `GC_ROOM_RE`)
- Modify: `app/tests/block-fill.test.ts` (удалить блоки `describe('webRoomFromGc')` и `describe('mirrorDayUrl')` и убрать эти имена из импорта)
- Modify: `app/src/components/RoomsEditor.tsx` (строка импорта)

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `webRoomFromGc(gc: string): string`
  - `mirrorDayUrl(s: string, fromDay: number, toDay: number): string`
  - `mirrorSlotRoomUrl(url: string, from: '15' | '19'): string`

- [ ] **Step 1: Написать падающий тест**

Создать `app/tests/room-urls.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Запустить: `npx vitest run tests/room-urls.test.ts`
Ожидается: FAIL — `Cannot find module '../src/lib/room-urls'`.

- [ ] **Step 3: Создать модуль**

Создать `app/src/lib/room-urls.ts`:

```ts
/**
 * room-urls.ts — правила адресов вебинарных комнат. Чистые функции: ни БД,
 * ни node:*, ни побочных эффектов — их зовёт клиентский RoomsEditor.
 *
 * Три преобразования, каждое замерено по живой базе (спека
 * docs/superpowers/specs/2026-08-13-rooms-grid-autofill-design.md):
 * дневное зеркало 4032/4032, слотовое 264/264, Web из GC 528/528.
 */

const GC_ROOM_RE = /^https?:\/\/gc\.ksamata\.ru\/([^\s/]+)$/i;

/**
 * Derive the Web-room URL from a GC-room URL: the slug is shared between the
 * two platforms. Only single-segment gc.ksamata.ru paths qualify — course
 * pages like gc.ksamata.ru/svs/bonus1 are not rooms.
 * Returns '' when the value doesn't look like a GC room link.
 */
export function webRoomFromGc(gc: string): string {
  const m = GC_ROOM_RE.exec(gc.trim());
  return m ? `https://web.ksamatacenter.com/room/${m[1]}` : '';
}

/**
 * Mirror a room url into another day by replacing the standalone day digit:
 * 1dbo-bookv → 2dbo-bookv, dih1-15-rsya → dih2-15-rsya. "Standalone" means not
 * adjacent to another digit, so the 15/19 time tokens survive.
 */
export function mirrorDayUrl(s: string, fromDay: number, toDay: number): string {
  return s.replace(new RegExp(`(?<!\\d)${fromDay}(?!\\d)`, 'g'), String(toDay));
}

/** Replace a standalone time token inside a slug; null when it isn't there. */
function swapTime(slug: string, from: string, to: string): string | null {
  const re = new RegExp(`(^|[-_.])${from}(?=[-_.]|$)`);
  return re.test(slug) ? slug.replace(re, `$1${to}`) : null;
}

/**
 * Mirror a room url from one time slot to the other. Two families, and the
 * slug itself says which one (264/264 historical pairs, no third case):
 *   A — the slug carries the time token: dbo1-15-vks ↔ dbo1-19-vks;
 *   B — the day digit moves across the first word: 1dbo-bookv ↔ dbo1-bookv.
 * Returns '' when neither applies, and also when the slug carries the OTHER
 * slot's token — such an address contradicts the cell it sits in, and family B
 * would happily rearrange it into garbage.
 */
export function mirrorSlotRoomUrl(url: string, from: '15' | '19'): string {
  const to = from === '15' ? '19' : '15';
  const cut = url.lastIndexOf('/');
  if (cut < 0) return '';
  const head = url.slice(0, cut + 1);
  const slug = url.slice(cut + 1);
  if (!slug) return '';

  const swapped = swapTime(slug, from, to);
  if (swapped) return head + swapped;
  if (swapTime(slug, to, from)) return '';

  const m = from === '15'
    ? /^(\d)([a-z]+)(.*)$/i.exec(slug)   // 1dbo-bookv → dbo1-bookv
    : /^([a-z]+)(\d)(.*)$/i.exec(slug);  // dbo1-bookv → 1dbo-bookv
  return m ? `${head}${m[2]}${m[1]}${m[3]}` : '';
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Запустить: `npx vitest run tests/room-urls.test.ts`
Ожидается: PASS, все блоки зелёные.

- [ ] **Step 5: Убрать переехавшие функции из block-fill.ts**

В `app/src/lib/block-fill.ts` удалить целиком: константу `GC_ROOM_RE`, функцию `webRoomFromGc` с её doc-комментарием и функцию `mirrorDayUrl` с её doc-комментарием. Остальное — `parsePastedLine`, `mirrorSlotUrl`, `STANDARD_LINKS_LABELS`, `missingStandardLabels`, `formatBlockLinks`, `flattenToCommon`, `restoreByTime` — не трогать.

- [ ] **Step 6: Перевести импорт в RoomsEditor**

В `app/src/components/RoomsEditor.tsx` заменить строку

```ts
import { webRoomFromGc, mirrorDayUrl } from '@/lib/block-fill';
```

на

```ts
import { webRoomFromGc, mirrorDayUrl } from '@/lib/room-urls';
```

(`mirrorDayUrl` там пока ещё нужен — его использует `fillFromDay1`, который уйдёт в задаче 3.)

- [ ] **Step 7: Убрать переехавшие тесты из block-fill.test.ts**

В `app/tests/block-fill.test.ts` удалить блоки `describe('webRoomFromGc', …)` и `describe('mirrorDayUrl', …)` целиком, а из импорта — имена `webRoomFromGc` и `mirrorDayUrl`.

- [ ] **Step 8: Прогнать весь набор и типы**

Запустить: `npx vitest run && npx tsc --noEmit`
Ожидается: все тесты PASS, `tsc` без вывода.

- [ ] **Step 9: Коммит**

```bash
git add app/src/lib/room-urls.ts app/tests/room-urls.test.ts app/src/lib/block-fill.ts app/tests/block-fill.test.ts app/src/components/RoomsEditor.tsx
git commit -m "refactor(rooms): правила адресов комнат в отдельный модуль + слотовое зеркало"
```

---

### Task 2: Достройка сетки

**Files:**
- Modify: `app/src/lib/rooms-grid.ts` (добавить `fillRoomGrid`)
- Modify: `app/tests/rooms-grid.test.ts` (добавить блок тестов)

**Interfaces:**
- Consumes: `webRoomFromGc`, `mirrorDayUrl`, `mirrorSlotRoomUrl` из `@/lib/room-urls` (задача 1); `SLOTS`, `gridKey`, `RoomGrid`, `RoomCell` из того же файла.
- Produces: `fillRoomGrid(grid: RoomGrid, dayCount: number, replayEnabled: boolean): RoomGrid` — возвращает **новую** сетку, исходную не мутирует.

- [ ] **Step 1: Написать падающий тест**

В конец `app/tests/rooms-grid.test.ts` дописать (и добавить `fillRoomGrid` в существующий импорт из `../src/lib/rooms-grid`):

```ts
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
```

- [ ] **Step 2: Убедиться, что тест падает**

Запустить: `npx vitest run tests/rooms-grid.test.ts`
Ожидается: FAIL — `fillRoomGrid is not a function` (или ошибка импорта).

- [ ] **Step 3: Реализовать fillRoomGrid**

В `app/src/lib/rooms-grid.ts` добавить импорт первой строкой после существующего импорта типа:

```ts
import { mirrorDayUrl, mirrorSlotRoomUrl, webRoomFromGc } from './room-urls';
```

и в конец файла:

```ts
type FillField = 'gcRoom' | 'webRoom' | 'replayUrl';

/**
 * Источник для пустой ячейки. Своим слотом пользуемся в первую очередь: там
 * нужно только дневное зеркало — единственное преобразование, верное на всех
 * 4032 парах дней живой базы. Чужой слот добавляет к нему слотовое (264/264).
 * Повтор из чужого слота не выводится вовсе: правила, связывающего повтор с
 * комнатой или со вторым временем, в данных нет (38 из 44 — не правило).
 *
 * Источник, в котором дневное зеркало ничего не изменило, отбраковывается:
 * цифры дня в адресе нет, и класть его в другой день значит размножить один
 * и тот же адрес по всей колонке. В живой базе таких нет — но пустая ячейка
 * честнее, чем пять ссылок на одну комнату.
 */
function sourceFor(grid: RoomGrid, slot: string, day: number, field: FillField, dayCount: number): string {
  for (let d = 1; d <= dayCount; d++) {
    const v = grid[gridKey(slot, d)]?.[field].trim();
    if (!v) continue;
    const byDay = mirrorDayUrl(v, d, day);
    if (byDay === v && d !== day) continue;
    return byDay;
  }
  if (field === 'replayUrl') return '';
  const other = slot === '15' ? '19' : '15';
  for (let d = 1; d <= dayCount; d++) {
    const v = grid[gridKey(other, d)]?.[field].trim();
    if (!v) continue;
    const byDay = mirrorDayUrl(v, d, day);
    if (byDay === v && d !== day) continue;
    return mirrorSlotRoomUrl(byDay, other);
  }
  return '';
}

/**
 * Достроить пустые ячейки сетки по образцу заполненных. Два прохода: сначала
 * каждое поле выводится из одноимённого (GC из GC, Web из Web, повтор из
 * повтора), затем оставшийся пустым Web берётся из GC своей же ячейки — это и
 * позволяет развернуть всю сетку из одной введённой комнаты.
 *
 * Оба прохода читают ИСХОДНУЮ сетку, а не промежуточный результат: иначе
 * порядок обхода влиял бы на вывод. Непустое поле не перетирается никогда,
 * даже если отличается от выводимого — это правка человека.
 */
export function fillRoomGrid(grid: RoomGrid, dayCount: number, replayEnabled: boolean): RoomGrid {
  const fields: FillField[] = replayEnabled ? ['gcRoom', 'webRoom', 'replayUrl'] : ['gcRoom', 'webRoom'];
  const out: RoomGrid = { ...grid };

  for (const slot of SLOTS) for (let d = 1; d <= dayCount; d++) {
    const k = gridKey(slot, d);
    const cell: RoomCell = { ...(out[k] ?? { gcRoom: '', webRoom: '', replayUrl: '' }) };
    for (const f of fields) {
      if (cell[f].trim() !== '') continue;
      const v = sourceFor(grid, slot, d, f, dayCount);
      if (v) cell[f] = v;
    }
    out[k] = cell;
  }

  for (const slot of SLOTS) for (let d = 1; d <= dayCount; d++) {
    const c = out[gridKey(slot, d)];
    if (c.webRoom.trim() === '' && c.gcRoom.trim() !== '') {
      const web = webRoomFromGc(c.gcRoom);
      if (web) c.webRoom = web;
    }
  }

  return out;
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Запустить: `npx vitest run tests/rooms-grid.test.ts`
Ожидается: PASS.

- [ ] **Step 5: Прогнать весь набор и типы**

Запустить: `npx vitest run && npx tsc --noEmit`
Ожидается: все PASS, `tsc` без вывода.

- [ ] **Step 6: Коммит**

```bash
git add app/src/lib/rooms-grid.ts app/tests/rooms-grid.test.ts
git commit -m "feat(rooms): fillRoomGrid — достройка сетки по одной заполненной ячейке"
```

---

### Task 3: Кнопка «Заполнить остальные»

**Files:**
- Modify: `app/src/components/RoomsEditor.tsx`

**Interfaces:**
- Consumes: `fillRoomGrid` из `@/lib/rooms-grid` (задача 2), `webRoomFromGc` из `@/lib/room-urls` (задача 1).
- Produces: ничего для других задач.

- [ ] **Step 1: Заменить логику заполнения**

В `app/src/components/RoomsEditor.tsx`:

1. Импорты. Строку `import { webRoomFromGc, mirrorDayUrl } from '@/lib/room-urls';` заменить на `import { webRoomFromGc } from '@/lib/room-urls';`, а в импорте из `@/lib/rooms-grid` добавить `fillRoomGrid`:

```ts
import { webRoomFromGc } from '@/lib/room-urls';
import { SLOTS, buildGrid, cellsFromGrid, fillRoomGrid, gridKey as key, type RoomCell as Cell, type RoomGrid as Grid } from '@/lib/rooms-grid';
```

`useMemo` добавить в импорт из `react`: `import { useEffect, useMemo, useRef, useState } from 'react';`

2. Удалить целиком: константу `FILL_FIELDS`, вычисление `canFillFromDay1` со всем его комментарием и функцию `fillFromDay1`.

3. На их место (сразу после `autofillWeb`) вставить:

```ts
  // Сетка, достроенная по уже заполненным ячейкам. Кнопка предлагается ровно
  // тогда, когда достройка что-то меняет — отдельной эвристики «есть ли что
  // заполнить» нет, иначе она разъедется с самой достройкой.
  const filled = useMemo(() => fillRoomGrid(grid, dayCount, replay), [grid, dayCount, replay]);
  const canFill =
    JSON.stringify(cellsFromGrid(filled, dayCount)) !== JSON.stringify(cellsFromGrid(grid, dayCount));
```

4. Кнопку заменить. Было:

```tsx
          {canFillFromDay1 && (
            <button type="button" onClick={fillFromDay1}
              title="Заполнить пустые дни ссылками дня 1 с заменой номера дня"
              className="flex items-center gap-1 text-[12px] font-semibold text-[var(--orange)]">
              <Wand2 size={13} /> Заполнить из дня 1
            </button>
          )}
```

Стало:

```tsx
          {canFill && (
            <button type="button" onClick={() => setGrid(filled)}
              title="Достроить пустые ячейки по образцу заполненных: другой день, второе время, Web из GC"
              className="flex items-center gap-1 text-[12px] font-semibold text-[var(--orange)]">
              <Wand2 size={13} /> Заполнить остальные
            </button>
          )}
```

- [ ] **Step 2: Проверить типы и весь набор тестов**

Запустить: `npx vitest run && npx tsc --noEmit`
Ожидается: все PASS, `tsc` без вывода. Если `tsc` ругается на неиспользуемый импорт `Cell` — оставить его: тип используется в `set()` и в `FragmentRow`.

- [ ] **Step 3: Собрать production-бандл**

Запустить: `npm run build`
Ожидается: сборка проходит. Это единственная проверка, ловящая поломку edge-бандла (см. раздел про `next.config.ts` в CLAUDE.md); новых node-only импортов мы не вносим, но проверить дёшево.

- [ ] **Step 4: Проверить руками в браузере**

Поднять dev-сервер и открыть карточку воронки с пустой сеткой комнат (создать черновик через «+» на списке). Проверить:

1. Сетка пуста — кнопки «Заполнить остальные» нет.
2. Ввести в GC 15:00 дня 1 `https://gc.ksamata.ru/1dbo-bookv`, уйти из поля — Web этой ячейки заполнился сам, кнопка появилась.
3. Нажать кнопку — заполнились все 20 полей: 19:00 дня 1 стало `https://gc.ksamata.ru/dbo1-bookv`, 15:00 дня 5 — `https://gc.ksamata.ru/5dbo-bookv`, Web везде на `web.ksamatacenter.com/room/…`.
4. Кнопка после нажатия исчезла (достраивать больше нечего).
5. Включить «повтор», вписать в повтор 15:00 дня 4 `https://gc.ksamata.ru/4rboo-kvspb` — кнопка появилась; нажать — повтор 15:00 дня 5 стал `https://gc.ksamata.ru/5rboo-kvspb`, а повторы 19:00 остались пустыми.

**Важно:** после проверки восстановить базу — dev-сервер пишет в `monitor_*` того же файла:

```bash
sqlite3 ksamata_funnels.db 'PRAGMA wal_checkpoint(TRUNCATE);' && git checkout -- ksamata_funnels.db && rm -f ksamata_funnels.db-wal ksamata_funnels.db-shm
```

Проверить: `git status --porcelain` — чисто, и `sqlite3 ksamata_funnels.db "select count(*) from monitor_targets;"` печатает `0`. Черновик, созданный для проверки, удалить через карточку.

- [ ] **Step 5: Коммит**

```bash
git add app/src/components/RoomsEditor.tsx
git commit -m "feat(rooms): кнопка «Заполнить остальные» вместо «Заполнить из дня 1»"
```

---

### Task 4: Обновить документацию

**Files:**
- Modify: `CLAUDE.md` (раздел «Domain helpers»)
- Modify: `docs/project-map.md`

**Interfaces:**
- Consumes: готовые модули задач 1–3.
- Produces: ничего.

- [ ] **Step 1: Дописать CLAUDE.md**

В раздел «Domain helpers (`app/src/lib/`)», сразу после строки про `block-fill.ts`, вставить пункт:

```markdown
- `room-urls.ts` — правила адресов вебинарных комнат: `webRoomFromGc`,
  `mirrorDayUrl`, `mirrorSlotRoomUrl`. Слотовое зеркало знает **две** семьи
  слагов, и это не украшение: половина воронок несёт время в адресе
  (`dbo1-15-vks` ↔ `dbo1-19-vks`), у другой половины времени в адресе нет
  вовсе и второе время получается перестановкой цифры дня через первое слово
  (`1dbo-bookv` ↔ `dbo1-bookv`). Замер по живой базе: 151 + 113, третьего
  случая нет. Не путать с `mirrorSlotUrl` из `block-fill.ts` — тот правит
  подписи и произвольные URL блоков заменой токена `15` и семьи B не знает;
  перестановка цифры дня в подписи блока дала бы мусор.
```

В том же разделе к строке про `rooms-grid.ts` (`build/flatten the rooms grid (slot × day)`) дописать:

```markdown
  Там же `fillRoomGrid` — достройка пустых ячеек по образцу заполненных
  (кнопка «Заполнить остальные»). Источник ищется сначала в своём слоте, где
  хватает дневного зеркала, и только потом в чужом. **Повтор выводится
  только по дням своего слота:** правила, связывающего повтор с комнатой,
  в данных нет — «вставить `r` после цифры дня» верно в 38 случаях из 44.
```

- [ ] **Step 2: Дописать docs/project-map.md**

В [docs/project-map.md:33](../../project-map.md) в перечислении домена заменить

```
  status, rooms-grid, funnel-compact, export, validation, авторизация
```

на

```
  status, rooms-grid (+ room-urls - правила адресов комнат: Web из GC,
  зеркало по дням, зеркало 15↔19 двух семей), funnel-compact, export,
  validation, авторизация
```

- [ ] **Step 3: Коммит**

```bash
git add CLAUDE.md docs/project-map.md
git commit -m "docs: room-urls.ts и достройка сетки комнат"
```

---

## Проверка после всех задач

Из `app/`:

```bash
npx vitest run && npx tsc --noEmit && npm run build
```

Из корня репозитория:

```bash
git status --porcelain
```

Ожидается: тесты зелёные, `tsc` молчит, сборка проходит, `ksamata_funnels.db` не изменён.
