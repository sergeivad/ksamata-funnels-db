# Статус «Архив» для воронок — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить третий статус воронки «Архив» (`archive`) к существующим `active`/`draft`, скрыть архивные из вкладки «Все» и дать управление статусом через меню из трёх действий.

**Architecture:** Вводим единый модуль `app/src/lib/status.ts` как источник правды по статусам (значения, тип, guard'ы, метаданные UI, предикат фильтра). Zod-enum и все UI-компоненты (бейдж, фильтр списка, меню карточки, форма редактирования) ссылаются на этот модуль. Миграция БД не нужна — колонка `status` это TEXT без CHECK-ограничения.

**Tech Stack:** Next.js (App Router, React 18, TS), Zod, Drizzle + better-sqlite3, Vitest, Tailwind, lucide-react.

## Global Constraints

- Все команды выполняются из каталога `app/` (там `package.json`, `tsconfig.json`). Корневого `package.json` нет.
- Тесты: `npx vitest run <file>` (скрипт `test` = `vitest` в watch-режиме — в плане всегда `run`).
- Типизация: `npx tsc --noEmit`. Линт: `npm run lint`.
- В репозитории **нет** тестов рендера компонентов (нет React Testing Library) — презентационная/интерактивная логика проверяется вынесением чистых функций в `lib/` + тестами на них и финальной проверкой сборки/браузера. Не добавлять RTL.
- Статус в БД — TEXT без CHECK, дефолт `'active'`. **Миграции БД не создавать.**
- Русские подписи копируются дословно из этого плана.

---

## File Structure

- **Create** `app/src/lib/status.ts` — единый источник правды: значения статусов, тип `FunnelStatus`, guard'ы, предикат фильтра `matchesStatusFilter`, метаданные UI (`STATUS_META`, `STATUS_ACTION_LABELS`, `STATUS_TOAST`).
- **Create** `app/tests/status.test.ts` — тесты чистых функций/данных из `status.ts`.
- **Modify** `app/src/lib/validation.ts` — `status` enum строится из `FUNNEL_STATUS_VALUES`.
- **Modify** `app/tests/validation.test.ts` — `archive` проходит в create и update.
- **Modify** `app/src/components/StatusPill.tsx` — данные из `STATUS_META`, ветка «Архив».
- **Modify** `app/src/components/FunnelCompactView.tsx` — убрать схлопывание не-active → draft при передаче в StatusPill.
- **Modify** `app/src/app/page.tsx` — вкладка «Архив» в фильтре, предикат через `matchesStatusFilter`, обработчик `handleSetStatus` вместо бинарного тумблера.
- **Modify** `app/src/components/FunnelCard.tsx` — меню «···» из трёх действий вместо кнопки Play/Pause.
- **Modify** `app/src/components/FunnelIdentity.tsx` — третья опция «Архив» в Segmented, убрать схлопывание не-active → draft.

---

## Task 1: Единый модуль статусов + расширение Zod-enum

**Files:**
- Create: `app/src/lib/status.ts`
- Create: `app/tests/status.test.ts`
- Modify: `app/src/lib/validation.ts:52`
- Modify: `app/tests/validation.test.ts`

**Interfaces:**
- Produces:
  - `FUNNEL_STATUS_VALUES: readonly ['active','draft','archive']`
  - `FUNNEL_STATUSES` (алиас того же массива, для итерации в UI)
  - `type FunnelStatus = 'active' | 'draft' | 'archive'`
  - `isFunnelStatus(v: unknown): v is FunnelStatus`
  - `type StatusFilter = 'all' | FunnelStatus`
  - `isStatusFilter(v: unknown): v is StatusFilter`
  - `matchesStatusFilter(status: string, filter: StatusFilter): boolean`
  - `STATUS_META: Record<FunnelStatus, { label: string; className: string }>`
  - `STATUS_ACTION_LABELS: Record<FunnelStatus, string>`
  - `STATUS_TOAST: Record<FunnelStatus, string>`

- [ ] **Step 1: Написать падающий тест `tests/status.test.ts`**

```ts
import { describe, test, expect } from 'vitest';
import {
  isFunnelStatus,
  isStatusFilter,
  matchesStatusFilter,
  STATUS_META,
  STATUS_ACTION_LABELS,
  FUNNEL_STATUS_VALUES,
} from '../src/lib/status';

describe('isFunnelStatus', () => {
  test('accepts the three statuses', () => {
    expect(isFunnelStatus('active')).toBe(true);
    expect(isFunnelStatus('draft')).toBe(true);
    expect(isFunnelStatus('archive')).toBe(true);
  });
  test('rejects unknown / non-string', () => {
    expect(isFunnelStatus('foo')).toBe(false);
    expect(isFunnelStatus(undefined)).toBe(false);
    expect(isFunnelStatus(3)).toBe(false);
  });
});

describe('matchesStatusFilter', () => {
  test('"all" shows active and draft but hides archive', () => {
    expect(matchesStatusFilter('active', 'all')).toBe(true);
    expect(matchesStatusFilter('draft', 'all')).toBe(true);
    expect(matchesStatusFilter('archive', 'all')).toBe(false);
  });
  test('specific filter matches only that status', () => {
    expect(matchesStatusFilter('archive', 'archive')).toBe(true);
    expect(matchesStatusFilter('active', 'archive')).toBe(false);
    expect(matchesStatusFilter('draft', 'draft')).toBe(true);
  });
});

describe('isStatusFilter', () => {
  test('accepts all + three statuses, rejects junk', () => {
    expect(isStatusFilter('all')).toBe(true);
    expect(isStatusFilter('archive')).toBe(true);
    expect(isStatusFilter('nope')).toBe(false);
  });
});

describe('STATUS_META / STATUS_ACTION_LABELS', () => {
  test('every status has a non-empty label and a bg- className', () => {
    for (const s of FUNNEL_STATUS_VALUES) {
      expect(STATUS_META[s].label.length).toBeGreaterThan(0);
      expect(STATUS_META[s].className).toContain('bg-');
      expect(STATUS_ACTION_LABELS[s].length).toBeGreaterThan(0);
    }
  });
  test('archive copy is correct', () => {
    expect(STATUS_META.archive.label).toBe('Архив');
    expect(STATUS_ACTION_LABELS.archive).toBe('В архив');
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run tests/status.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/status'`.

- [ ] **Step 3: Создать `src/lib/status.ts`**

```ts
// Единый источник правды по статусам воронки. Значения совпадают с тем, что
// хранится в колонке funnels.status (TEXT, без CHECK). Меняешь набор здесь —
// подхватывают Zod-схема, бейдж, фильтр списка, меню карточки и форма.
export const FUNNEL_STATUS_VALUES = ['active', 'draft', 'archive'] as const;
export type FunnelStatus = (typeof FUNNEL_STATUS_VALUES)[number];

// Алиас для итерации в UI (по смыслу тот же массив).
export const FUNNEL_STATUSES = FUNNEL_STATUS_VALUES;

export function isFunnelStatus(v: unknown): v is FunnelStatus {
  return typeof v === 'string' && (FUNNEL_STATUS_VALUES as readonly string[]).includes(v);
}

// Фильтр вкладок на главной. 'all' — рабочие воронки (активные + черновики),
// архив из него исключён и виден только на своей вкладке.
export type StatusFilter = 'all' | FunnelStatus;

export function isStatusFilter(v: unknown): v is StatusFilter {
  return v === 'all' || isFunnelStatus(v);
}

export function matchesStatusFilter(status: string, filter: StatusFilter): boolean {
  if (filter === 'all') return status !== 'archive';
  return status === filter;
}

// Бейдж StatusPill: подпись + tailwind-классы фона/текста.
export const STATUS_META: Record<FunnelStatus, { label: string; className: string }> = {
  active: { label: 'Активна', className: 'bg-[#DFF3E7] text-[#087443]' },
  draft: { label: 'Черновик', className: 'bg-[#E8E4DA] text-[#5E5A52]' },
  archive: { label: 'Архив', className: 'bg-[#E0E0E0] text-[#6B6B6B]' },
};

// Подписи действий в меню смены статуса на карточке.
export const STATUS_ACTION_LABELS: Record<FunnelStatus, string> = {
  active: 'Сделать активной',
  draft: 'В черновик',
  archive: 'В архив',
};

// Тосты после успешной смены статуса.
export const STATUS_TOAST: Record<FunnelStatus, string> = {
  active: 'Воронка активирована',
  draft: 'Воронка переведена в черновик',
  archive: 'Воронка перемещена в архив',
};
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npx vitest run tests/status.test.ts`
Expected: PASS (все describe зелёные).

- [ ] **Step 5: Подключить enum к Zod в `src/lib/validation.ts`**

Добавить импорт в начало файла (после строки `import { z } from 'zod';`):

```ts
import { FUNNEL_STATUS_VALUES } from './status';
```

Заменить строку 52:

```ts
  status: z.enum(['active', 'draft']),
```

на:

```ts
  status: z.enum(FUNNEL_STATUS_VALUES),
```

- [ ] **Step 6: Добавить тесты в `tests/validation.test.ts`**

В `describe('funnelCreateSchema', …)` после теста `status="draft" passes` (строка 58) добавить:

```ts
  test('status="archive" passes', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, status: 'archive' }).success
    ).toBe(true);
  });
```

В `describe('funnelUpdateSchema', …)` после теста `partial valid update passes` (строка 127) добавить:

```ts
  test('status="archive" passes in partial update', () => {
    expect(
      funnelUpdateSchema.safeParse({ status: 'archive' }).success
    ).toBe(true);
  });
```

- [ ] **Step 7: Запустить тесты валидации — убедиться, что проходят**

Run: `npx vitest run tests/status.test.ts tests/validation.test.ts`
Expected: PASS. В частности старый тест `status="foo" is rejected` остаётся зелёным (enum по-прежнему отвергает мусор).

- [ ] **Step 8: Коммит**

```bash
git add app/src/lib/status.ts app/tests/status.test.ts app/src/lib/validation.ts app/tests/validation.test.ts
git commit -m "feat(status): единый модуль статусов + archive в Zod-enum"
```

---

## Task 2: Бейдж «Архив» (StatusPill, data-driven)

**Files:**
- Modify: `app/src/components/StatusPill.tsx` (весь файл)
- Modify: `app/src/components/FunnelCompactView.tsx:44`

**Interfaces:**
- Consumes: `isFunnelStatus`, `STATUS_META` из `@/lib/status` (Task 1).
- Produces: `StatusPill` принимает `status: string` и рендерит бейдж для любого из трёх статусов; неизвестное значение → бейдж «Черновик» (безопасный дефолт).

- [ ] **Step 1: Переписать `src/components/StatusPill.tsx`**

Полностью заменить содержимое файла на:

```tsx
import { isFunnelStatus, STATUS_META } from '@/lib/status';

interface StatusPillProps {
  // string, а не FunnelStatus: часть источников (FunnelDetail.status) типизированы
  // как string; неизвестное значение безопасно падает в «Черновик».
  status: string;
}

export default function StatusPill({ status }: StatusPillProps) {
  const meta = isFunnelStatus(status) ? STATUS_META[status] : STATUS_META.draft;
  return (
    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  );
}
```

- [ ] **Step 2: Убрать схлопывание в `FunnelCompactView.tsx:44`**

Заменить строку 44:

```tsx
        <StatusPill status={funnel.status === 'active' ? 'active' : 'draft'} />
```

на:

```tsx
        <StatusPill status={funnel.status} />
```

- [ ] **Step 3: Типизация — убедиться, что нет ошибок**

Run: `npx tsc --noEmit`
Expected: без ошибок (в т.ч. FunnelCard передаёт `funnel.status` — присваивается `string` без проблем).

- [ ] **Step 4: Коммит**

```bash
git add app/src/components/StatusPill.tsx app/src/components/FunnelCompactView.tsx
git commit -m "feat(status): бейдж «Архив» через STATUS_META"
```

---

## Task 3: Вкладка «Архив» и смена статуса в списке (page.tsx)

**Files:**
- Modify: `app/src/app/page.tsx`

**Interfaces:**
- Consumes: `FunnelStatus`, `StatusFilter`, `isStatusFilter`, `matchesStatusFilter`, `STATUS_TOAST` из `@/lib/status` (Task 1).
- Produces: `handleSetStatus(funnel, newStatus)` — оптимистичный PATCH статуса; вкладка фильтра «Архив»; `renderCard` передаёт в `FunnelCard` проп `onSetStatus` (см. Task 4).

- [ ] **Step 1: Заменить локальные определения статуса на импорт**

В шапке файла заменить строки 15–25:

```tsx
type StatusFilter = 'all' | 'active' | 'draft';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'draft', label: 'Черновики' },
];

function isStatusFilter(v: unknown): v is StatusFilter {
  return v === 'all' || v === 'active' || v === 'draft';
}
```

на:

```tsx
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'draft', label: 'Черновики' },
  { value: 'archive', label: 'Архив' },
];
```

И добавить импорт рядом с прочими импортами (после строки 10 `import { confirmUnsavedNavigation } …`):

```tsx
import {
  type FunnelStatus,
  type StatusFilter,
  isStatusFilter,
  matchesStatusFilter,
  STATUS_TOAST,
} from '@/lib/status';
```

- [ ] **Step 2: Расширить тип статуса в `FunnelListItem`**

Заменить строку 38:

```tsx
  status: 'active' | 'draft';
```

на:

```tsx
  status: FunnelStatus;
```

- [ ] **Step 3: Заменить бинарный обработчик на `handleSetStatus`**

Заменить весь блок `handleActivateToggle` (строки 141–179) на:

```tsx
  const handleSetStatus = useCallback(
    async (funnel: FunnelListItem, newStatus: FunnelStatus) => {
      if (funnel.status === newStatus) return;
      const prevStatus = funnel.status;

      // Optimistic update
      setFunnels((prev) =>
        prev.map((f) => (f.id === funnel.id ? { ...f, status: newStatus } : f))
      );

      try {
        const res = await fetch(`/api/funnels/${funnel.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });

        if (!res.ok) {
          throw new Error('Ошибка сервера');
        }

        const updated = await res.json();
        setFunnels((prev) =>
          prev.map((f) => (f.id === funnel.id ? { ...f, status: updated.status } : f))
        );

        showToast(STATUS_TOAST[newStatus], 'success');
      } catch {
        // Rollback
        setFunnels((prev) =>
          prev.map((f) => (f.id === funnel.id ? { ...f, status: prevStatus } : f))
        );
        showToast('Не удалось изменить статус', 'error');
      }
    },
    []
  );
```

- [ ] **Step 4: Обновить предикат фильтра**

Заменить блок `visibleFunnels` (строки 239–245):

```tsx
  const visibleFunnels = useMemo(() => {
    return funnels.filter(
      (f) =>
        (statusFilter === 'all' || f.status === statusFilter) &&
        matchesSearch(f, search)
    );
  }, [funnels, statusFilter, search]);
```

на:

```tsx
  const visibleFunnels = useMemo(() => {
    return funnels.filter(
      (f) => matchesStatusFilter(f.status, statusFilter) && matchesSearch(f, search)
    );
  }, [funnels, statusFilter, search]);
```

- [ ] **Step 5: Прокинуть новый проп в `renderCard`**

Заменить в `renderCard` (строка 287):

```tsx
        onActivateToggle={() => handleActivateToggle(funnel)}
```

на:

```tsx
        onSetStatus={(s) => handleSetStatus(funnel, s)}
```

- [ ] **Step 6: Типизация — убедиться, что нет ошибок**

Run: `npx tsc --noEmit`
Expected: одна ожидаемая ошибка — `FunnelCard` ещё не знает про `onSetStatus` (исправляется в Task 4). Всё остальное чисто. Если есть другие ошибки в `page.tsx` — исправить их сейчас.

> Примечание: `handleStatusFilterChange` (строки 100–108) уже вызывает `isStatusFilter` — теперь это импортированная версия, принимающая `'archive'`. Код менять не нужно, но убедись, что старое локальное определение удалено (Step 1).

- [ ] **Step 7: Коммит**

```bash
git add app/src/app/page.tsx
git commit -m "feat(status): вкладка «Архив» и смена статуса из списка"
```

---

## Task 4: Меню из трёх действий на карточке (FunnelCard)

**Files:**
- Modify: `app/src/components/FunnelCard.tsx` (весь файл)

**Interfaces:**
- Consumes: `FunnelStatus`, `FUNNEL_STATUSES`, `STATUS_ACTION_LABELS` из `@/lib/status`; проп `onSetStatus` от `page.tsx` (Task 3).
- Produces: `FunnelCard` с меню «···»; проп `onActivateToggle` удалён, добавлен `onSetStatus: (status: FunnelStatus) => void`.

- [ ] **Step 1: Переписать `src/components/FunnelCard.tsx`**

Полностью заменить содержимое файла на:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Copy, MoreVertical, Trash2 } from 'lucide-react';
import CodeChip from './CodeChip';
import StatusPill from './StatusPill';
import { FUNNEL_STATUSES, STATUS_ACTION_LABELS, type FunnelStatus } from '@/lib/status';

interface Funnel {
  id: number;
  frontCode: string;
  status: FunnelStatus;
  title: string;
}

interface FunnelCardProps {
  funnel: Funnel;
  onSetStatus: (status: FunnelStatus) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export default function FunnelCard({
  funnel,
  onSetStatus,
  onDuplicate,
  onDelete,
}: FunnelCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const href = `/funnels/${funnel.id}`;
  const containerClass =
    'grid grid-cols-[minmax(0,1fr)_80px_auto_22px] items-center gap-3 rounded-[8px] border px-3 py-2.5 text-left transition max-[760px]:grid-cols-[minmax(0,1fr)_auto] border-[var(--color-border-soft)] bg-[rgba(255,255,255,0.38)] hover:bg-white';

  const actionBtnClass =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border bg-white transition border-[var(--color-border-soft)] text-[#111111] hover:border-[#111111]';

  return (
    <div className={containerClass}>
      {/* Left: code chip (click copies) + title link — real <a>, so
          Cmd/middle-click opens the funnel in a new tab */}
      <div className="flex min-w-0 items-center gap-2">
        <CodeChip code={funnel.frontCode} />
        <Link
          href={href}
          className="min-w-0 flex-1 truncate text-[13px] font-semibold hover:underline"
        >
          {funnel.title}
        </Link>
      </div>

      {/* Status pill — wrapped so the span sizes to its text instead of
          stretching to fill the grid column (which left a big empty gap). */}
      <div className="min-w-0">
        <StatusPill status={funnel.status} />
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-1">
        {/* Status menu */}
        <div className="relative">
          <button
            type="button"
            className={actionBtnClass}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Изменить статус"
            title="Изменить статус"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              {/* Full-screen backdrop closes the menu on outside click */}
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setMenuOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-0 top-9 z-20 min-w-[160px] overflow-hidden rounded-[8px] border border-[var(--color-border-soft)] bg-white py-1 shadow-lg"
              >
                {FUNNEL_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="menuitem"
                    disabled={funnel.status === s}
                    onClick={() => {
                      setMenuOpen(false);
                      onSetStatus(s);
                    }}
                    className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-[#111111] transition hover:bg-[#F5F3EE] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    {STATUS_ACTION_LABELS[s]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Duplicate */}
        <button
          type="button"
          className={actionBtnClass}
          onClick={onDuplicate}
          aria-label="Дублировать"
          title="Дублировать"
        >
          <Copy className="h-4 w-4" />
        </button>

        {/* Delete */}
        <button
          type="button"
          className={[
            actionBtnClass,
            'border-[#F3B8AD] text-[#B42318] hover:bg-[#FFF4F1]',
          ].join(' ')}
          onClick={onDelete}
          aria-label="Удалить"
          title="Удалить"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Trailing chevron */}
      <Link
        href={href}
        className="max-[760px]:hidden flex h-5 w-5 items-center justify-center text-[var(--color-text-secondary)]"
        aria-label="Открыть"
        tabIndex={-1}
      >
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Типизация — убедиться, что нет ошибок**

Run: `npx tsc --noEmit`
Expected: без ошибок (ошибка из Task 3 Step 6 про `onSetStatus` теперь устранена).

- [ ] **Step 3: Прогнать полный набор тестов**

Run: `npx vitest run`
Expected: PASS — вся существующая логика не затронута.

- [ ] **Step 4: Коммит**

```bash
git add app/src/components/FunnelCard.tsx
git commit -m "feat(status): меню из трёх действий на карточке воронки"
```

---

## Task 5: Третья опция «Архив» в форме редактирования (FunnelIdentity)

**Files:**
- Modify: `app/src/components/FunnelIdentity.tsx:30,42,139`

**Interfaces:**
- Consumes: `STATUS_META` из `@/lib/status` (для подписей опций Segmented — используем `label`).
- Produces: форма отправляет `status` из трёх допустимых значений; не схлопывает не-active в draft.

- [ ] **Step 1: Не схлопывать статус при инициализации стейта (строка 30)**

Заменить строку 30:

```tsx
  const [status, setStatus] = useState(funnel.status === 'active' ? 'active' : 'draft');
```

на:

```tsx
  const [status, setStatus] = useState<string>(funnel.status);
```

- [ ] **Step 2: Не схлопывать статус в снапшоте «saved» (строка 42)**

Заменить строку 42 (внутри `useState<IdentitySnapshot>({ … })`):

```tsx
    status: funnel.status === 'active' ? 'active' : 'draft',
```

на:

```tsx
    status: funnel.status,
```

- [ ] **Step 3: Добавить третью опцию в Segmented (строка 139)**

Добавить импорт рядом с существующими (после строки 9 `import RefSelect from './RefSelect';`):

```tsx
import { STATUS_META } from '@/lib/status';
```

Заменить строку 139:

```tsx
          <Segmented options={[{ value: 'active', label: 'Активна' }, { value: 'draft', label: 'Черновик' }]} value={status} onChange={setStatus} />
```

на:

```tsx
          <Segmented
            options={[
              { value: 'active', label: STATUS_META.active.label },
              { value: 'draft', label: STATUS_META.draft.label },
              { value: 'archive', label: STATUS_META.archive.label },
            ]}
            value={status}
            onChange={setStatus}
          />
```

- [ ] **Step 4: Типизация — убедиться, что нет ошибок**

Run: `npx tsc --noEmit`
Expected: без ошибок. (`status` остаётся `string`; PATCH-тело на строке 114 уже шлёт `submitted.status` — код менять не нужно.)

- [ ] **Step 5: Коммит**

```bash
git add app/src/components/FunnelIdentity.tsx
git commit -m "feat(status): опция «Архив» в форме редактирования воронки"
```

---

## Task 6: Полная проверка (тесты, типы, линт, браузер)

**Files:** нет изменений кода — только верификация; при находках исправить в соответствующей задаче и переиспользовать её коммит.

- [ ] **Step 1: Полный прогон тестов**

Run: `npx vitest run`
Expected: PASS, все файлы зелёные, включая новый `tests/status.test.ts` и обновлённый `tests/validation.test.ts`.

- [ ] **Step 2: Типизация всего проекта**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Линт**

Run: `npm run lint`
Expected: без ошибок (при новых warning'ах — устранить).

- [ ] **Step 4: Прод-сборка**

Run: `npm run build`
Expected: `next build` завершается успешно.

- [ ] **Step 5: Браузерная проверка сценария**

Запустить dev-сервер из `app/` (`npm run dev`, порт 3000) и через preview-инструменты проверить:
1. Главная: сегментированный фильтр показывает «Все / Активные / Черновики / Архив».
2. На карточке кнопка «···» открывает меню с тремя действиями; текущий статус задизейблен.
3. Нажать «В архив» на любой воронке → тост «Воронка перемещена в архив», карточка исчезает из вкладки «Все».
4. Вкладка «Архив» → воронка отображается с серым бейджем «Архив».
5. В меню архивной карточки «Сделать активной» → возвращается во «Все».
6. Открыть карточку воронки → в форме идентификации Segmented показывает три опции; смена на «Архив» и «Сохранить идентификацию» → без ошибки; на главной статус = архив.

Собрать proof (скриншот вкладки «Архив» с серым бейджем).

- [ ] **Step 6: Финальный статус**

Работа завершена — все задачи закоммичены. Ветку/мердж согласовать с пользователем (см. superpowers:finishing-a-development-branch).

---

## Self-Review

**Spec coverage:**
- Модель данных (enum, без миграции) → Task 1. ✓
- Единый тип статуса → Task 1 (`lib/status.ts`). ✓
- Список и фильтр (вкладка «Архив», предикат «Все») → Task 3. ✓
- Бейдж «Архив» → Task 2. ✓
- Меню из трёх действий → Task 4; форма редактирования → Task 5. ✓
- Тесты (enum, фильтр-предикат) → Task 1; сценарная проверка → Task 6. ✓
- Вне scope (миграция БД, CSV, авто-архивация) — не затрагивается. ✓

**Placeholder scan:** плейсхолдеров нет; весь код приведён целиком.

**Type consistency:** `FunnelStatus`, `StatusFilter`, `matchesStatusFilter`, `STATUS_META`, `STATUS_ACTION_LABELS`, `STATUS_TOAST`, `FUNNEL_STATUS_VALUES`/`FUNNEL_STATUSES`, проп `onSetStatus: (status: FunnelStatus) => void` — имена и сигнатуры совпадают между Task 1 (определение) и Task 3/4/5 (использование). `StatusPill` принимает `status: string` во всех местах вызова.

> Замечание для исполнителя: сценарные тесты фильтра покрыты юнит-тестом `matchesStatusFilter` (Task 1). Рендер-тесты компонентов не добавляются намеренно — в репозитории нет RTL; UI проверяется сборкой (Task 6 Step 4) и браузером (Step 5), что соответствует принятой в проекте практике.
