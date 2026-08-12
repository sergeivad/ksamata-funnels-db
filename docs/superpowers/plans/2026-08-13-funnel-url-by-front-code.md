# Адрес воронки — F-код: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Карточка воронки открывается по F-коду (`/funnels/f86`), числовой адрес продолжает работать и редиректит на канон; семь архивных воронок без кода получают `f87`–`f93`.

**Architecture:** Сегмент маршрута разбирается чистой функцией `parseFunnelRef` в `front-code.ts` — там же живёт единственный строитель ссылки `funnelHref`. Страница ищет воронку (по коду или по id), потом сравнивает адрес с каноном и при расхождении делает 307. Схема БД и API не меняются вовсе.

**Tech Stack:** Next.js 15 (App Router, серверные компоненты), Drizzle + better-sqlite3, vitest, TypeScript.

Спека: [2026-08-12-funnel-url-by-front-code-design.md](../specs/2026-08-12-funnel-url-by-front-code-design.md)

## Global Constraints

- **Редирект временный — 307, не 308.** Next `redirect()` из `next/navigation` даёт 307 по умолчанию; `permanentRedirect` НЕ использовать: код редактируемый, а 308 браузер кеширует навсегда.
- **Порядок один на обе формы адреса: сначала найти воронку, потом решать про редирект.** `/funnels/F99`, где воронки нет, отдаёт 404 сразу, а не редиректит на `/funnels/f99`.
- **Ветка «кода нет → числовой адрес» остаётся в коде и в тестах** после разметки семи. Схема разрешает пустой код, очистка законна, восьмая такая воронка появится.
- **Код не выводится из `num` и не из `id`.** Дыры в нумерации не занимаются.
- **Воронки опознаются по `num`, не по `id`.** `id` у прода и базы репозитория разный (у F86: прод 83, репозиторий 80), `num` совпадает (78).
- **Данные правятся через `updateFunnel` / HTTP API, никогда raw SQL.**
- **Правка `ksamata_funnels.db` — отдельным коммитом.** Перед любым rebase: `git log --oneline <ветка>..main -- ksamata_funnels.db`; если печатает что-то — не rebase, а reset на новую базу и повторный прогон скрипта.
- Все команды — из `app/`, если не сказано иное. Проверка перед коммитом кода: `npx tsc --noEmit && npx vitest run`.

---

## Файловая структура

| Файл | Ответственность |
|---|---|
| `app/src/lib/front-code.ts` | **изменяется** — плюс `FunnelRef`, `parseFunnelRef`, `funnelHref`. Остаётся чистым (без БД): его видит клиентский бандл. |
| `app/src/lib/funnels.ts` | **изменяется** — плюс `getFunnelByFrontCode`. |
| `app/src/app/funnels/[id]/` → `[ref]/` | **переименование каталога** + новая логика разбора и редиректа в `page.tsx`. |
| `app/src/lib/auth.ts` | **изменяется** — одна строка в `PUBLIC_GET_PATTERNS`. |
| `app/src/components/FunnelCard.tsx`, `AppHeader.tsx`, `monitoring/MonitorTable.tsx`, `app/src/app/page.tsx` | **изменяются** — пять мест переводятся на `funnelHref`. |
| `app/src/app/help/page.tsx` | **изменяется** — абзац «Чем называть воронку». |
| `app/tests/funnel-href-consistency.test.ts` | **создаётся** — сторож: ссылка на карточку строится только в `front-code.ts`. |
| `app/scripts/assign-front-codes-2026-08-13.ts` | **создаётся** — коды семи архивным в базе репозитория. |
| `app/scripts/assign-front-codes-prod-2026-08-13.cjs` | **создаётся** — то же на проде, через его HTTP API изнутри контейнера. |

---

## Task 1: F-коды семи архивным в базе репозитория

**Files:**
- Create: `app/scripts/assign-front-codes-2026-08-13.ts`
- Modify: `ksamata_funnels.db` (корень репозитория, отдельным коммитом)

**Interfaces:**
- Consumes: `updateFunnel(db, id, { frontCode })` из `src/lib/funnels.ts`, `getFunnel(db, id)` оттуда же.
- Produces: семь воронок с кодами `f87`–`f93`. Ничего программного дальше по плану от этой задачи не зависит — задачи 3–8 самостоятельны.

- [ ] **Step 1: Перечитать максимум в ЛИК — замер устаревает**

Замер от 2026-08-12: в ЛИК 62 воронки, максимум `f86`, дыр там нет. Если между этим планом и выполнением в ЛИК завели воронку, максимум сдвинулся и коды сдвигаются вместе с ним.

Из залогиненной вкладки `https://leak.besales.ai/funnels/rules` (Chrome MCP, по сессионной куке — токена нет, `curl` не годится):

```js
const j = await (await fetch('/app-api/api/admin/funnels', {credentials:'include'})).json();
const ns = j.funnels.map(f => { const m = /^[Ff](\d+)$/.exec(String(f.funnelCode).trim()); return m ? Number(m[1]) : null; }).filter(n => n !== null);
({ total: j.funnels.length, maxF: Math.max(...ns) })
```

Ожидается `maxF: 86`. Если больше — коды в `TARGETS` ниже сдвинуть так, чтобы первый был `maxF + 1`, и записать новый замер в спеку.

- [ ] **Step 2: Написать скрипт**

Форма списана с `scripts/assign-front-codes-2026-07-28.ts` (тот же случай, три активные воронки). Отличия: только локальная база (прод — задача 2), и защита по `product_name`, а не по осям, потому что у архивных квизов оси могут быть неполны.

Создать `app/scripts/assign-front-codes-2026-08-13.ts`:

```ts
/**
 * F-коды семи АРХИВНЫМ воронкам, у которых кода не было (2026-08-13).
 *
 * ЦЕЛЬ — БАЗА РЕПОЗИТОРИЯ (`../ksamata_funnels.db`), НЕ ПРОД.
 * Прод правится отдельным скриптом assign-front-codes-prod-2026-08-13.cjs:
 * это разные базы, и прогон здесь до людей в админке не доезжает.
 *
 *   num  продукт                      код
 *    10  СВС НИМБ РСЯ                 f87
 *    14  ЖКТ NR МП                    f88
 *    17  ДБО FAQ MAX                  f89
 *    18  ДБО HT ВК                    f90
 *    29  БОО Яндекс Реклама квиз      f91
 *    30  ДБО Яндекс Реклама квиз      f92
 *    31  СВС Яндекс Реклама квиз БОО  f93
 *
 * ПОЧЕМУ С f87. Максимум по обеим системам — f86 (замер 2026-08-12: в ЛИК 62
 * воронки, выше f86 ничего). Дыры в нумерации (f1–f5, f10, f14, f17, f18, f20,
 * f44, f49, f65, f71, f72, f75, f76, f77) НЕ занимаются: это чужие номера,
 * ЛИК может выдать их в любой момент. То же правило зашито в `nextFrontCode`.
 *
 * ЧЕГО НЕ ДЕЛАТЬ. У четырёх воронок `num` равен 10, 14, 17, 18 — и ровно эти
 * номера стоят в дырах. Совпадение не правило: у оставшихся трёх (num 29, 30,
 * 31) коды f29, f30, f31 заняты живыми воронками. Вывод кода из `num` — та
 * самая ошибка, из-за которой поиск по f70 возвращал две разные воронки.
 *
 * ПОЧЕМУ АРХИВНЫМ. Решение владельца 2026-08-12: адрес карточки становится
 * F-кодом, и семь бескодовых иначе остались бы на числовом адресе. Это
 * отменяет довод скрипта от 2026-07-28 («архивные в ЛИК не заводим, код им не
 * нужен») — теперь заводим, код нужен всем.
 *
 * Защита: несовпавший product_name — пропуск; занятый код — пропуск;
 * непустой текущий код — пропуск. Идемпотентно.
 *
 * Запуск из app/ (сначала --dry-run):
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/assign-front-codes-2026-08-13.ts --dry-run
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/assign-front-codes-2026-08-13.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { updateFunnel } from '../src/lib/funnels';

const TARGETS: { num: number; code: string; productName: string }[] = [
  { num: 10, code: 'f87', productName: 'СВС НИМБ РСЯ' },
  { num: 14, code: 'f88', productName: 'ЖКТ NR МП' },
  { num: 17, code: 'f89', productName: 'ДБО FAQ MAX' },
  { num: 18, code: 'f90', productName: 'ДБО HT ВК' },
  { num: 29, code: 'f91', productName: 'БОО Яндекс Реклама квиз' },
  { num: 30, code: 'f92', productName: 'ДБО Яндекс Реклама квиз' },
  { num: 31, code: 'f93', productName: 'СВС Яндекс Реклама квиз БОО' },
];

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

let planned = 0;
let problems = 0;

for (const t of TARGETS) {
  const row = db
    .select({ id: funnels.id, code: funnels.frontCode, productName: funnels.productName })
    .from(funnels)
    .where(eq(funnels.num, t.num))
    .get();

  if (!row) {
    console.error(`  ! num=${t.num} не найдена`);
    problems++;
    continue;
  }

  const current = (row.code ?? '').trim();
  const taken = db
    .select({ num: funnels.num })
    .from(funnels)
    .where(eq(funnels.frontCode, t.code))
    .get();

  if (current === t.code) {
    console.log(`  = num=${t.num}: код уже ${t.code}`);
  } else if (current !== '') {
    console.error(`  ! num=${t.num}: код уже «${current}», ожидался пустой — пропускаю`);
    problems++;
  } else if ((row.productName ?? '').trim() !== t.productName) {
    console.error(`  ! num=${t.num}: продукт «${row.productName}» вместо «${t.productName}» — пропускаю`);
    problems++;
  } else if (taken) {
    console.error(`  ! код ${t.code} занят воронкой num=${taken.num} — пропускаю`);
    problems++;
  } else if (dryRun) {
    console.log(`  - num=${t.num}: «—» → «${t.code}»  (${t.productName})`);
    planned++;
  } else {
    updateFunnel(db, row.id, { frontCode: t.code });
    console.log(`  - num=${t.num}: код ${t.code} проставлен  (${t.productName})`);
    planned++;
  }
}

console.log(`\nИтого: ${planned} ${dryRun ? 'к правке' : 'правок'}, ${problems} проблем.`);
process.exit(problems > 0 ? 1 : 0);
```

- [ ] **Step 3: Прогнать вхолостую — это и есть проверка перед правкой**

```bash
cd app && FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/assign-front-codes-2026-08-13.ts --dry-run
```

Ожидается ровно семь строк вида `- num=10: «—» → «f87»` и `Итого: 7 к правке, 0 проблем.` Любая строка с `!` — стоп, разбираться, не применять.

- [ ] **Step 4: Применить**

```bash
cd app && FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/assign-front-codes-2026-08-13.ts --apply
```

Ожидается `Итого: 7 правок, 0 проблем.`

- [ ] **Step 5: Проверить результат в базе**

```bash
sqlite3 ksamata_funnels.db "select num, front_code, status from funnels where num in (10,14,17,18,29,30,31) order by num;"
```

Ожидается семь строк `f87`…`f93`, статус у всех `archive`. И проверка, что бескодовых не осталось:

```bash
sqlite3 ksamata_funnels.db "select count(*) from funnels where front_code is null or front_code='';"
```

Ожидается `0`.

- [ ] **Step 6: Убедиться, что мониторинг не нагадил в базу**

Скрипт не поднимает сервер, но если dev-сервер работал — таблицы `monitor_*` могли наполниться. Проверить:

```bash
sqlite3 ksamata_funnels.db "select count(*) from monitor_targets;"
```

Ожидается `0`. Если не ноль — остановить сервер и восстановить по рецепту из `CLAUDE.md` (раздел «Monitoring gotcha»), затем повторить шаги 4–5.

- [ ] **Step 7: Коммит — двумя коммитами, скрипт и данные врозь**

Данные отдельно, потому что бинарный `.db` нельзя перенести rebase'ом, и его правка должна быть воспроизводима запуском скрипта.

```bash
git add app/scripts/assign-front-codes-2026-08-13.ts
git commit -m "script(front-code): коды f87..f93 семи архивным воронкам"
git add ksamata_funnels.db
git commit -m "data(funnels): f87..f93 проставлены семи архивным воронкам"
```

---

## Task 2: те же коды на проде

**Files:**
- Create: `app/scripts/assign-front-codes-prod-2026-08-13.cjs`

**Interfaces:**
- Consumes: прод-API `GET /api/funnels`, `PATCH /api/funnels/{id}` с телом `{ frontCode }`.
- Produces: те же семь кодов в проде. От задачи 1 не зависит технически, но список кодов должен совпадать.

- [ ] **Step 1: Написать скрипт**

`.cjs`, а не `.ts`: в контейнере нет `tsx`. Запускается **изнутри контейнера** против `127.0.0.1:3000`, учётка читается из его же `ADMIN_USERS` — пароль нигде не набирается и не вставляется.

Создать `app/scripts/assign-front-codes-prod-2026-08-13.cjs`:

```js
/**
 * ЦЕЛЬ — ПРОД (/data/ksamata_funnels.db), через его собственный HTTP API.
 * Локальную базу правит assign-front-codes-2026-08-13.ts — это разные базы.
 *
 * Запускается ИЗНУТРИ контейнера: в нём нет tsx, поэтому .cjs; и учётка
 * берётся из его же ADMIN_USERS, поэтому пароль никуда не вводится руками.
 *
 * Связь по `num`: id у прода и базы репозитория свои (у F86 прод 83,
 * репозиторий 80), `num` совпадает. Дополнительно сверяется productName.
 *
 *   docker exec -it <container> node /app/scripts/assign-front-codes-prod-2026-08-13.cjs --dry-run
 *   docker exec -it <container> node /app/scripts/assign-front-codes-prod-2026-08-13.cjs --apply
 */
const BASE = process.env.SELF_BASE_URL || 'http://127.0.0.1:3000';

const TARGETS = [
  { num: 10, code: 'f87', productName: 'СВС НИМБ РСЯ' },
  { num: 14, code: 'f88', productName: 'ЖКТ NR МП' },
  { num: 17, code: 'f89', productName: 'ДБО FAQ MAX' },
  { num: 18, code: 'f90', productName: 'ДБО HT ВК' },
  { num: 29, code: 'f91', productName: 'БОО Яндекс Реклама квиз' },
  { num: 30, code: 'f92', productName: 'ДБО Яндекс Реклама квиз' },
  { num: 31, code: 'f93', productName: 'СВС Яндекс Реклама квиз БОО' },
];

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

// ADMIN_USERS — «имя:пароль» через запятую; берём первую пару.
const first = String(process.env.ADMIN_USERS || '').split(',')[0].trim();
if (!first || !first.includes(':')) {
  console.error('ADMIN_USERS не задан или пуст — редактор не определён');
  process.exit(2);
}
const AUTH = 'Basic ' + Buffer.from(first).toString('base64');

async function main() {
  const res = await fetch(`${BASE}/api/funnels`, { headers: { Authorization: AUTH } });
  if (!res.ok) {
    console.error(`GET /api/funnels → HTTP ${res.status}`);
    process.exit(1);
  }
  const list = await res.json();
  const byNum = new Map(list.map((f) => [f.num, f]));
  console.log(`Прод: ${list.length} воронок.\n`);

  let planned = 0;
  let problems = 0;

  for (const t of TARGETS) {
    const f = byNum.get(t.num);
    if (!f) {
      console.error(`  ! num=${t.num} на проде не найдена`);
      problems++;
      continue;
    }
    const current = (f.frontCode || '').trim();
    if (current === t.code) {
      console.log(`  = num=${t.num}: код уже ${t.code}`);
      continue;
    }
    if (current !== '') {
      console.error(`  ! num=${t.num}: код уже «${current}» — пропускаю`);
      problems++;
      continue;
    }
    if ((f.productName || '').trim() !== t.productName) {
      console.error(`  ! num=${t.num}: продукт «${f.productName}» вместо «${t.productName}» — пропускаю`);
      problems++;
      continue;
    }
    if (dryRun) {
      console.log(`  - num=${t.num} (id=${f.id}): «—» → «${t.code}»`);
      planned++;
      continue;
    }
    const patch = await fetch(`${BASE}/api/funnels/${f.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: AUTH },
      body: JSON.stringify({ frontCode: t.code }),
    });
    if (patch.ok) {
      console.log(`  - num=${t.num}: код ${t.code} проставлен (HTTP ${patch.status})`);
      planned++;
    } else {
      console.error(`  ! num=${t.num}: HTTP ${patch.status} ${(await patch.text()).slice(0, 200)}`);
      problems++;
    }
  }

  console.log(`\nИтого: ${planned} ${dryRun ? 'к правке' : 'правок'}, ${problems} проблем.`);
  process.exit(problems > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Сделать резервную копию прод-базы перед правкой**

WAL на проде живой и большой, поэтому копия снимается через `VACUUM INTO`, а не `cp`.

```bash
docker exec -it <container> sh -c "sqlite3 /data/ksamata_funnels.db \"VACUUM INTO '/data/backup-2026-08-13.db';\" && ls -la /data/"
```

Ожидается файл `backup-2026-08-13.db` ненулевого размера.

- [ ] **Step 3: Доставить скрипт в контейнер и прогнать вхолостую**

Скрипт попадёт в образ при следующей сборке; до неё — копией:

```bash
docker cp app/scripts/assign-front-codes-prod-2026-08-13.cjs <container>:/app/scripts/
docker exec -it <container> node /app/scripts/assign-front-codes-prod-2026-08-13.cjs --dry-run
```

Ожидается семь строк `- num=... : «—» → «f8x»` и `Итого: 7 к правке, 0 проблем.`

- [ ] **Step 4: Применить и проверить**

```bash
docker exec -it <container> node /app/scripts/assign-front-codes-prod-2026-08-13.cjs --apply
```

Ожидается `Итого: 7 правок, 0 проблем.` Затем повторный `--dry-run` должен напечатать семь строк `= num=...: код уже f8x` и `Итого: 0 к правке, 0 проблем` — это и есть проверка идемпотентности.

- [ ] **Step 5: Коммит скрипта**

```bash
git add app/scripts/assign-front-codes-prod-2026-08-13.cjs
git commit -m "script(front-code): те же коды f87..f93 на проде через его API"
```

- [ ] **Step 6: Передать владельцу**

Сообщить: семь архивных воронок получили коды `f87`–`f93`, их нужно завести в ЛИК под этими же кодами. Список с продуктами — в шапке скрипта.

---

## Task 3: `parseFunnelRef` и `funnelHref`

**Files:**
- Modify: `app/src/lib/front-code.ts`
- Test: `app/tests/front-code.test.ts`

**Interfaces:**
- Consumes: `normalizeFrontCode(raw: string): string` — уже есть в этом файле.
- Produces:
  - `export type FunnelRef = { kind: 'code'; code: string } | { kind: 'id'; id: number }`
  - `export function parseFunnelRef(raw: string): FunnelRef | null`
  - `export function funnelHref(ref: { frontCode: string; id: number }): string`

- [ ] **Step 1: Написать падающий тест**

Дописать в конец `app/tests/front-code.test.ts` (импорт сверху расширить на `parseFunnelRef` и `funnelHref`):

```ts
describe('parseFunnelRef', () => {
  it('F-код — канон адреса, регистр приводится', () => {
    expect(parseFunnelRef('f86')).toEqual({ kind: 'code', code: 'f86' });
    expect(parseFunnelRef('F86')).toEqual({ kind: 'code', code: 'f86' });
  });

  it('чистые цифры — это id, а не код', () => {
    expect(parseFunnelRef('83')).toEqual({ kind: 'id', id: 83 });
    // Ведущие нули законны как id: страница потом уведёт на канон.
    expect(parseFunnelRef('083')).toEqual({ kind: 'id', id: 83 });
  });

  it('f086 — код, а не id: в базе лежит f86, это другая строка', () => {
    expect(parseFunnelRef('f086')).toEqual({ kind: 'code', code: 'f086' });
  });

  it('всё непонятное — null, то есть 404', () => {
    for (const raw of ['', '   ', 'f', 'abc', 'f86x', 'x86', '8 6', '-1', '1.5']) {
      expect(parseFunnelRef(raw), raw).toBeNull();
    }
  });

  it('небезопасно большое число — null, иначе id уедет в Infinity', () => {
    expect(parseFunnelRef('9'.repeat(25))).toBeNull();
  });
});

describe('funnelHref', () => {
  it('с кодом — адрес по коду', () => {
    expect(funnelHref({ frontCode: 'f86', id: 83 })).toBe('/funnels/f86');
  });

  it('без кода — числовой адрес, как и подпись funnelRefLabel', () => {
    expect(funnelHref({ frontCode: '', id: 83 })).toBe('/funnels/83');
    expect(funnelRefLabel({ frontCode: '', id: 83 })).toBe('#83');
  });

  it('разбор собственного адреса возвращает то же самое — пара обратима', () => {
    for (const f of [{ frontCode: 'f86', id: 83 }, { frontCode: '', id: 83 }]) {
      const seg = funnelHref(f).replace('/funnels/', '');
      const parsed = parseFunnelRef(seg);
      expect(parsed, seg).not.toBeNull();
      expect(parsed!.kind === 'code' ? parsed!.code : String(parsed!.id))
        .toBe(f.frontCode || String(f.id));
    }
  });
});
```

- [ ] **Step 2: Прогнать тест — он должен падать**

```bash
cd app && npx vitest run tests/front-code.test.ts
```

Ожидается провал сборки модуля: `parseFunnelRef` и `funnelHref` не экспортируются из `../src/lib/front-code`.

- [ ] **Step 3: Реализовать**

Дописать в конец `app/src/lib/front-code.ts`:

```ts
/**
 * Что стоит в адресе карточки. Две формы, и только две: F-код — канон,
 * числовой id — вечный запасной вход для старых ссылок.
 *
 * Различение по букве, а не по эвристике: `f86` — код, `86` — id. Без этого
 * адрес был бы двусмысленным, а совпадение кода с чужим id — обычное дело
 * (у F86 id равен 83, а id 86 принадлежит другой воронке).
 */
export type FunnelRef =
  | { kind: 'code'; code: string }
  | { kind: 'id'; id: number };

/**
 * Разбор сегмента адреса. `null` — 404: список форм закрытый, новая форма
 * должна появляться здесь явно, а не проскакивать как «похоже на число».
 *
 * Правило для цифр повторяет `parseRouteId` из validation.ts намеренно: тот
 * отвечает за API, этот — за страницу, и оба должны считать `id` одинаково.
 */
export function parseFunnelRef(raw: string): FunnelRef | null {
  const s = raw.trim();
  if (/^[Ff]\d+$/.test(s)) return { kind: 'code', code: normalizeFrontCode(s) };
  if (/^\d+$/.test(s)) {
    const id = Number(s);
    return Number.isSafeInteger(id) ? { kind: 'id', id } : null;
  }
  return null;
}

/**
 * Единственное место, где строится ссылка на карточку. До этого она
 * собиралась руками в пяти местах — ровно поэтому и разъезжалась.
 * Правило то же, что у `funnelRefLabel`: есть код — по коду, нет — по id.
 */
export function funnelHref(ref: { frontCode: string; id: number }): string {
  return ref.frontCode ? `/funnels/${ref.frontCode}` : `/funnels/${ref.id}`;
}
```

- [ ] **Step 4: Прогнать тест — должен пройти**

```bash
cd app && npx vitest run tests/front-code.test.ts
```

Ожидается PASS во всех блоках, включая старые.

- [ ] **Step 5: Коммит**

```bash
git add app/src/lib/front-code.ts app/tests/front-code.test.ts
git commit -m "feat(front-code): parseFunnelRef и funnelHref — разбор и сборка адреса карточки"
```

---

## Task 4: поиск воронки по F-коду

**Files:**
- Modify: `app/src/lib/funnels.ts`
- Test: `app/tests/api-funnels.test.ts`

**Interfaces:**
- Consumes: `getFunnel(db: DB, id: number): FunnelDetail | null`, `normalizeFrontCode` из `front-code.ts`.
- Produces: `export function getFunnelByFrontCode(db: DB, code: string): FunnelDetail | null`.

- [ ] **Step 1: Написать падающий тест**

Дописать в `app/tests/api-funnels.test.ts` (файл уже поднимает временную копию БД; импорт `getFunnelByFrontCode` добавить к существующему импорту из `../src/lib/funnels`).

Дескриптор БД в этом файле называется **`testDb`**, а заготовка тела — **`BASE_FUNNEL_DATA`** (`tests/api-funnels.test.ts:71`). У неё `num: 9900`, и `num` уникален — поэтому каждой воронке здесь свой номер, иначе второй `createFunnel` упадёт на 409, а не на проверяемом поведении. Номера и коды взяты заведомо выше живых, чтобы не столкнуться с реальными.

```ts
describe('getFunnelByFrontCode', () => {
  it('находит воронку по её коду', () => {
    const created = createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9901, frontCode: 'f9001' });
    expect(getFunnelByFrontCode(testDb, 'f9001')?.id).toBe(created.id);
  });

  it('регистр и пробелы не мешают — код нормализуется', () => {
    createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9902, frontCode: 'f9002' });
    expect(getFunnelByFrontCode(testDb, 'F9002')?.frontCode).toBe('f9002');
    expect(getFunnelByFrontCode(testDb, ' f9002 ')?.frontCode).toBe('f9002');
  });

  it('пустой код не ищется никогда — иначе бескодовые склеятся в одну', () => {
    createFunnel(testDb, { ...BASE_FUNNEL_DATA, num: 9903, frontCode: '' });
    expect(getFunnelByFrontCode(testDb, '')).toBeNull();
    expect(getFunnelByFrontCode(testDb, '   ')).toBeNull();
  });

  it('несуществующий код — null, а не чужая воронка', () => {
    expect(getFunnelByFrontCode(testDb, 'f9999')).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать тест — он должен падать**

```bash
cd app && npx vitest run tests/api-funnels.test.ts
```

Ожидается провал импорта: `getFunnelByFrontCode` не экспортируется.

- [ ] **Step 3: Реализовать**

Добавить в `app/src/lib/funnels.ts` сразу после `getFunnel` (около строки 326). Импорт `normalizeFrontCode` из `./front-code` в этом файле уже есть — он используется в `updateFunnel`.

```ts
/**
 * Воронка по F-коду — то, чем адрес карточки отличается от API.
 *
 * Пустой код не ищется НИКОГДА: `front_code` у бескодовых воронок хранится
 * пустой строкой, и запрос по '' вернул бы первую попавшуюся из них.
 * Уникальность непустого кода держит частичный индекс Phase 7.
 *
 * Тело читается через `getFunnel`, а не собирается заново: материализация
 * тегов и осей должна жить в одном месте.
 */
export function getFunnelByFrontCode(db: DB, code: string): FunnelDetail | null {
  const normalized = normalizeFrontCode(code);
  if (normalized === '') return null;
  const row = db
    .select({ id: funnels.id })
    .from(funnels)
    .where(eq(funnels.frontCode, normalized))
    .get();
  return row ? getFunnel(db, row.id) : null;
}
```

- [ ] **Step 4: Прогнать тест — должен пройти**

```bash
cd app && npx vitest run tests/api-funnels.test.ts
```

Ожидается PASS.

- [ ] **Step 5: Коммит**

```bash
git add app/src/lib/funnels.ts app/tests/api-funnels.test.ts
git commit -m "feat(funnels): getFunnelByFrontCode — поиск воронки по F-коду"
```

---

## Task 5: маршрут `/funnels/[ref]` с редиректом на канон

**Files:**
- Rename: `app/src/app/funnels/[id]/` → `app/src/app/funnels/[ref]/`
- Modify: `app/src/app/funnels/[ref]/page.tsx`

**Interfaces:**
- Consumes: `parseFunnelRef`, `funnelHref` (Task 3), `getFunnelByFrontCode` (Task 4), `getFunnel`.
- Produces: рабочий маршрут. Дальше по плану от него зависит только ручная проверка в Task 8.

- [ ] **Step 1: Переименовать каталог**

Сегмент больше не `id`, и имя параметра должно об этом говорить.

```bash
cd app && git mv src/app/funnels/\[id\] src/app/funnels/\[ref\] && ls src/app/funnels/
```

Ожидается `[ref]`.

- [ ] **Step 2: Переписать page.tsx**

Полное содержимое `app/src/app/funnels/[ref]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { db } from '@/db/client';
import { getFunnel, getFunnelByFrontCode } from '@/lib/funnels';
import { parseFunnelRef, funnelHref } from '@/lib/front-code';
import { listDays } from '@/lib/funnel-days';
import { listBlocks } from '@/lib/funnel-blocks';
import FunnelSections from '@/components/FunnelSections';

interface PageProps { params: Promise<{ ref: string }> }

export default async function FunnelEditPage({ params }: PageProps) {
  const { ref } = await params;
  const parsed = parseFunnelRef(ref);
  if (!parsed) notFound();

  // Сначала ищем воронку, и только потом решаем про редирект: /funnels/F99,
  // где такой воронки нет, должен отдать 404 сразу, а не вести через переход
  // на /funnels/f99, который тоже 404 — иначе на каждую опечатку лишний
  // переход, а в адресной строке оседает несуществующий код.
  const funnel = parsed.kind === 'code'
    ? getFunnelByFrontCode(db, parsed.code)
    : getFunnel(db, parsed.id);
  if (!funnel) notFound();

  // Канон — F-код. Числовой адрес и ненормализованный код работают вечно, но
  // уводят на канон. Одно сравнение закрывает все случаи: «83» → «/funnels/f86»,
  // «F86» → «/funnels/f86», «083» → «/funnels/f86», а у воронки без кода
  // «7» совпадает с каноном и перехода не будет.
  //
  // Переход ВРЕМЕННЫЙ (redirect даёт 307), а не постоянный: 308 браузер
  // кеширует навсегда, а код редактируемый — поменяли f86 на f90, и
  // закешированный переход годами водит на 404.
  //
  // Заодно лечит вторую ловушку: увидев на карточке «F86», человек набирает
  // /funnels/86 руками. 86 — валидный id, и без перехода страница молча
  // показала бы чужую воронку; теперь адресная строка сразу покажет чужой код.
  const canonical = funnelHref(funnel);
  if (`/funnels/${ref}` !== canonical) redirect(canonical);

  const initialDays = listDays(db, funnel.id);
  const blocks = listBlocks(db, funnel.id);
  const landings = blocks.find((b) => b.kind === 'landings')!;
  const rest = blocks.filter((b) => b.kind !== 'landings');

  return (
    <main className="mx-auto max-w-[1120px] px-6 py-8">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1 text-[13px] text-[var(--muted)] transition hover:text-[var(--ink)]"
      >
        <ChevronLeft size={15} /> Все воронки
      </Link>
      <FunnelSections funnel={funnel} funnelId={funnel.id} initialDays={initialDays} landings={landings} rest={rest} />
    </main>
  );
}
```

Внутрь `FunnelSections` уходит числовой `funnel.id` — API машинный, его не трогаем.

- [ ] **Step 3: Проверить типы и полный прогон тестов**

```bash
cd app && npx tsc --noEmit && npx vitest run
```

Ожидается: типы чисты, все тесты зелёные.

- [ ] **Step 4: Проверить руками на dev-сервере**

Поднять превью (`MONITOR_ENABLED=false` в `.env.local`, иначе фоновая проверка нагадит в отслеживаемую базу) и пройти пять адресов. `f87` существует после Task 1; для формы без кода взять любую воронку, у которой код пуст — после Task 1 таких нет, поэтому проверяется временно: снять код у одной воронки в админке, проверить `/funnels/<id>`, вернуть код обратно.

| Адрес | Ожидание |
|---|---|
| `/funnels/f86` | страница, адрес не меняется |
| `/funnels/F86` | адрес меняется на `/funnels/f86` |
| `/funnels/80` | адрес меняется на `/funnels/f86` (id локальной базы) |
| `/funnels/f9999` | 404 |
| `/funnels/abc` | 404 |

- [ ] **Step 5: Восстановить базу, если мониторинг успел записать**

```bash
sqlite3 ksamata_funnels.db "select count(*) from monitor_targets;"
```

Ожидается `0`. Если нет — рецепт из `CLAUDE.md`, раздел «Monitoring gotcha».

- [ ] **Step 6: Коммит**

```bash
git add app/src/app/funnels
git commit -m "feat(routing): карточка открывается по F-коду, числовой адрес редиректит на канон"
```

---

## Task 6: канонический адрес открыт анониму

**Files:**
- Modify: `app/src/lib/auth.ts:297-317`
- Test: `app/tests/auth.test.ts:222-256`

**Interfaces:**
- Consumes: `isPublicReadPath(pathname: string): boolean` — уже есть.
- Produces: ничего нового; меняется поведение существующей функции.

- [ ] **Step 1: Написать падающий тест**

В `app/tests/auth.test.ts` в блок `isPublicReadPath` → тест «открывает список воронок…» добавить в список путей:

```ts
      '/funnels/f86', '/funnels/f86/', '/funnels/F86',
```

И в тест «оставляет закрытым всё, что не про воронки» добавить:

```ts
      '/funnels/f86/edit', '/funnels/f', '/funnels/f86x',
```

- [ ] **Step 2: Прогнать тест — он должен падать**

```bash
cd app && npx vitest run tests/auth.test.ts
```

Ожидается провал на `/funnels/f86`: `expected false to be true`.

- [ ] **Step 3: Реализовать**

В `app/src/lib/auth.ts` в массив `PUBLIC_GET_PATTERNS` добавить строку сразу после `/^\/funnels\/\d+$/`:

```ts
  // Канонический адрес карточки. Список белый, поэтому без этой строки
  // аноним — тот самый, кому кинули ссылку, — получил бы редирект на вход.
  // Числовой шаблон выше остаётся: по нему приходят старые ссылки, и переход
  // на канон должен случиться, а не превратиться в требование залогиниться.
  //
  // [Ff], а не флаг `i`: ссылку с прописной буквой аноним тоже должен
  // открыть — её же уводит на канон сама страница. Флаг `i` на всём шаблоне
  // заодно открыл бы «/FUNNELS/…», чего никто не просил.
  /^\/funnels\/[Ff]\d+$/,
```

- [ ] **Step 4: Прогнать тест — должен пройти**

```bash
cd app && npx vitest run tests/auth.test.ts && npx vitest run
```

Ожидается PASS везде.

- [ ] **Step 5: Коммит**

```bash
git add app/src/lib/auth.ts app/tests/auth.test.ts
git commit -m "fix(auth): канонический адрес карточки открыт анониму на чтение"
```

---

## Task 7: все ссылки через `funnelHref` и сторож против рецидива

**Files:**
- Modify: `app/src/components/FunnelCard.tsx:35`
- Modify: `app/src/components/AppHeader.tsx:44`
- Modify: `app/src/components/monitoring/MonitorTable.tsx:101,114`
- Modify: `app/src/app/page.tsx:221`
- Test: `app/tests/funnel-href-consistency.test.ts` (создаётся)

**Interfaces:**
- Consumes: `funnelHref(ref: { frontCode: string; id: number }): string` (Task 3).
- Produces: ничего нового.

- [ ] **Step 1: Написать падающий сторож-тест**

Приём тот же, что в `tests/link-labels-consistency.test.ts`: тест читает исходники и сравнивает настоящее положение дел, а не переписывает его заново.

Создать `app/tests/funnel-href-consistency.test.ts`:

```ts
/**
 * Ссылка на карточку собиралась руками в пяти местах — FunnelCard, AppHeader,
 * MonitorTable (дважды) и page.tsx. Ровно поэтому она и разъезжалась: сменив
 * канон адреса, нужно было вспомнить про все пять.
 *
 * Тест падает, если `/funnels/` с подстановкой снова появится где-то, кроме
 * `front-code.ts`. Статический текст (например `<Code>/funnels/78</Code>` в
 * справке) и регулярки в `auth.ts` не ловятся: там нет ни интерполяции, ни
 * конкатенации, а значит и разъезжаться нечему.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const ALLOWED = 'lib/front-code.ts';

// Динамическая сборка адреса: `/funnels/${…}` или '/funnels/' + …
const OFFENDERS = [/\/funnels\/\$\{/, /['"`]\/funnels\/['"`]\s*\+/];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('ссылка на карточку строится только в front-code.ts', () => {
  it('нигде в src/ нет собранного руками /funnels/<подстановка>', () => {
    const guilty: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      if (rel === ALLOWED) continue;
      const text = readFileSync(file, 'utf8');
      if (OFFENDERS.some((re) => re.test(text))) guilty.push(rel);
    }
    expect(guilty, `собери адрес через funnelHref: ${guilty.join(', ')}`).toEqual([]);
  });

  it('сторож не бутафория — он ловит собранный руками адрес', () => {
    expect(OFFENDERS.some((re) => re.test('href={`/funnels/${funnel.id}`}'))).toBe(true);
    expect(OFFENDERS.some((re) => re.test("router.push('/funnels/' + id)"))).toBe(true);
    expect(OFFENDERS.some((re) => re.test('<Code>/funnels/78</Code>'))).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать тест — он должен падать**

```bash
cd app && npx vitest run tests/funnel-href-consistency.test.ts
```

Ожидается провал с перечислением четырёх файлов: `components/FunnelCard.tsx, components/AppHeader.tsx, components/monitoring/MonitorTable.tsx, app/page.tsx`.

- [ ] **Step 3: Перевести FunnelCard**

Импорта из `@/lib/front-code` в этом файле **нет** — добавить новой строкой после строки 10 (`import { DEFAULT_FUNNEL_TYPE } from '@/lib/funnel-type';`):

```tsx
import { funnelHref } from '@/lib/front-code';
```

И заменить строку 35:

```tsx
  const href = funnelHref(funnel);
```

- [ ] **Step 4: Перевести AppHeader**

Импорта из `@/lib/front-code` здесь тоже **нет** — добавить `import { funnelHref } from '@/lib/front-code';` к прочим импортам, затем заменить строку 44:

```tsx
      router.push(funnelHref(funnel));
```

Черновик приезжает с уже выданным кодом (`createDraftFunnel` его аллоцирует), поэтому иначе переход шёл бы через лишний редирект.

- [ ] **Step 5: Перевести MonitorTable — оба места**

Единственный из четырёх файлов, где импорт уже есть — строка 9, `import { funnelRefLabel } from '@/lib/front-code';`. Расширить её до `import { funnelRefLabel, funnelHref } from '@/lib/front-code';` и заменить обе строки `href`:

```tsx
                        href={funnelHref(f)}
```

```tsx
                          href={funnelHref(f)}
```

- [ ] **Step 6: Перевести page.tsx**

Импорта из `@/lib/front-code` здесь **нет** — добавить `import { funnelHref } from '@/lib/front-code';` к прочим импортам, затем заменить строку 221:

```tsx
        router.push(funnelHref(duplicated));
```

- [ ] **Step 7: Прогнать сторож и весь набор**

```bash
cd app && npx vitest run tests/funnel-href-consistency.test.ts && npx tsc --noEmit && npx vitest run
```

Ожидается PASS везде, список виноватых пуст.

- [ ] **Step 8: Коммит**

```bash
git add app/src/components app/src/app/page.tsx app/tests/funnel-href-consistency.test.ts
git commit -m "refactor(links): все ссылки на карточку через funnelHref + сторож против рецидива"
```

---

## Task 8: справка и CLAUDE.md

**Files:**
- Modify: `app/src/app/help/page.tsx:83-96`
- Modify: `CLAUDE.md`

**Interfaces:** нет — только текст.

- [ ] **Step 1: Переписать абзац в справке**

В `app/src/app/help/page.tsx` заменить блок «Чем называть воронку» целиком. Уходит неверный пример (`f84` → `/funnels/78` — это id локальной базы, на проде у неё другой) и устаревшее «Выдаёт его ЛИК, а не эта база»: с 2026-08-04 код назначает база, а ЛИК принимает.

```tsx
        <Sub>Чем называть воронку</Sub>
        <P>
          F-кодом: <Code>f42</Code>, <Code>f84</Code>. Так её называют в ЛИК, в
          таблицах и в переписке — и так же выглядит её адрес:{' '}
          <Code>/funnels/f84</Code>. На карточке код стоит слева от имени.
        </P>
        <P>
          Код выдаёт эта база — следующий свободный номер выше максимума.
          Дальше воронку заводят в ЛИК под тем же кодом, чтобы она называлась
          одинаково в обеих системах.
        </P>
        <P>
          Старые ссылки вида <Code>/funnels/78</Code> продолжают работать: они
          сами переводят на адрес с кодом. Но набирать такое число руками не
          стоит — оно служебное, с F-кодом не совпадает и в разных копиях базы
          разное. То же и с колонкой <Code>ID</Code> в выгрузке CSV: там третье
          число. Называйте воронку F-кодом.
        </P>
```

- [ ] **Step 2: Проверить, что справка собирается и открыта анониму**

```bash
cd app && npx tsc --noEmit && npx vitest run tests/auth.test.ts
```

Ожидается: типы чисты, тесты справки (`/help` в белом списке) зелёные.

- [ ] **Step 3: Дописать правило в CLAUDE.md**

В раздел `## Conventions`, в пункт про `num` («Never show `num` to a human…»), дописать в конец абзаца:

```markdown
  Адрес карточки — тоже F-код: `/funnels/f86`. Строится он **только** через
  `funnelHref` ([app/src/lib/front-code.ts](app/src/lib/front-code.ts)) —
  собранный руками `/funnels/${id}` ловит
  [app/tests/funnel-href-consistency.test.ts](app/tests/funnel-href-consistency.test.ts).
  Числовой адрес остаётся вечным запасным входом и редиректит на канон
  временным 307: постоянный 308 браузер кеширует навсегда, а код редактируем.
```

В разделе `## Pages & components` заменить `funnels/[id]/page.tsx` на `funnels/[ref]/page.tsx (edit; сегмент — F-код либо id)`.

В разделе про `front-code.ts` (`## Domain helpers`) дописать после описания `nextFrontCode`:

```markdown
  `parseFunnelRef` разбирает сегмент адреса (`f86` → код, `86` → id, прочее →
  404), `funnelHref` его собирает. Различение по букве, а не по эвристике:
  код воронки и чужой `id` совпадают сплошь и рядом — у F86 `id` равен 83,
  а `id` 86 принадлежит другой воронке.
```

- [ ] **Step 4: Полная проверка перед коммитом**

```bash
cd app && npx tsc --noEmit && npx vitest run && npm run build
```

`npm run build` обязателен: Edge-сборка ломается на вещах, которых не видят ни типы, ни тесты (см. `next.config.ts`).

- [ ] **Step 5: Коммит**

```bash
git add app/src/app/help/page.tsx CLAUDE.md
git commit -m "docs(help): адрес карточки — F-код; убран неверный пример со служебным id"
```

---

## Финальная проверка на боевой сборке

Юнит-тесты не видят `matcher` мидлвары — расхождение ловится только на `.next/standalone` (см. `CLAUDE.md`, раздел про синглтоны и Auth).

- [ ] **Step 1: Собрать и поднять standalone**

```bash
cd app && npm run build && node .next/standalone/server.js
```

- [ ] **Step 2: Проверить анонимом — код должен открыться, число увести на канон**

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://127.0.0.1:3000/funnels/f86
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://127.0.0.1:3000/funnels/80
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://127.0.0.1:3000/funnels/F86
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://127.0.0.1:3000/funnels/f9999
```

Ожидается: `200`, `307 …/funnels/f86`, `307 …/funnels/f86`, `404`. **Ни одного `307 …/login`** — это и была бы та самая поломка, которую не видят тесты.

- [ ] **Step 3: Восстановить базу**

```bash
sqlite3 ksamata_funnels.db "select count(*) from monitor_targets;"
git status --porcelain
```

Ожидается `0` и чистое дерево.
