# Пилюля «Проверить» и состояние ссылок воронки — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** в списке воронок появляется пилюля «Проверить» у воронки, чьи адреса не отвечают, а на карточке — секция с разбором и кнопкой ручной проверки.

**Architecture:** комнаты (`funnel_days`) становятся ещё тремя видами источника существующего мониторинга; для `web.ksamatacenter.com` вводится признак «200, но за ним пусто» с канарейкой против тихого протухания; состояние воронки считается при чтении из `monitor_target_funnels` + `monitor_state`; ручная проверка — тот же цикл по подмножеству целей под отдельным флагом.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Drizzle + better-sqlite3, vitest, Tailwind, lucide-react.

**Spec:** [docs/superpowers/specs/2026-09-18-funnel-health-check-design.md](../specs/2026-09-18-funnel-health-check-design.md)

## Global Constraints

- Все команды — из каталога `app/`. Проверки: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
- **Имена тестов русские.** `npx vitest run <file> -t '<фрагмент>'` с английским фильтром молча выберет ноль тестов и выйдет с кодом 0.
- Тесты работают на временной **копии** реальной БД через `copyDbForTest` ([app/tests/helpers/db.ts](../../../app/tests/helpers/db.ts)), никогда на живом файле. Каждый монитор-тест сразу после `runMigratePhase6` зовёт `clearMonitoringState` ([app/tests/helpers/monitoring.ts](../../../app/tests/helpers/monitoring.ts)).
- **Схема не меняется.** Ни таблиц, ни колонок, ни фазы в `app/docker-entrypoint.sh`. Если по ходу кажется, что нужна миграция, — остановиться и вернуться к спеке.
- **Edge-ловушка.** Любой `node:*`-импорт в модуле под `src/lib/monitor-*.ts` валит `npm run build`, оставляя `tsc` и тесты зелёными (см. комментарий в `app/next.config.ts`). `monitor-content.ts` и `monitor-canary.ts` обязаны оставаться без `node:*`. Node-only код изолируется в собственный лист-файл и алиасится там же.
- **Состояние процесса — только на `globalThis`**, не в модульном `let`: прод-бандл раздваивает модули.
- После любого живого прогона восстановить `ksamata_funnels.db` (`git checkout --`, снести `-wal`/`-shm`) и убедиться, что `select count(*) from monitor_targets` даёт `0`.
- Не показывать `num` человеку; воронка называется `frontCode`.
- Коммиты заканчиваются строкой `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Карта файлов

| файл | ответственность | задача |
|---|---|---|
| `app/src/lib/monitor-content.ts` | **создать** — признак «200, но пусто», чистый, без сети | 1 |
| `app/src/lib/monitor-canary.ts` | **создать** — канарейка с кэшем на `globalThis` | 1 |
| `app/src/lib/monitor-check.ts` | читать первые 8 КБ тела для хостов с признаком | 1 |
| `app/src/lib/monitor-status.ts` | `parseSqliteUtc`, `roomCheckLabel` | 1, 4 |
| `app/src/app/api/monitoring/route.ts` | отдать `roomCheck` рядом со `summary` | 1 |
| `app/src/components/monitoring/MonitorSummary.tsx` | строка «Проверка комнат» | 1 |
| `app/src/lib/monitor-kinds.ts` | реестр видов источника: блоки ∪ комнаты | 2 |
| `app/src/lib/monitor-targets.ts` | комнаты как источник; дефолт групп; связи по всем статусам; `syncFunnelTargets` | 2, 3, 5 |
| `app/src/lib/monitor-view.ts` | `usage` из связей, без пересборки URL | 3 |
| `app/src/lib/monitor-funnel-health.ts` | **создать** — агрегат по воронке и происхождение адресов | 4 |
| `app/src/app/api/monitoring/funnels/route.ts` | **создать** — состояние всех воронок | 4 |
| `app/src/app/api/monitoring/funnels/[id]/route.ts` | **создать** — разбор одной воронки | 4 |
| `app/src/app/api/monitoring/funnels/[id]/run/route.ts` | **создать** — запуск ручной проверки | 5 |
| `app/src/lib/monitor-run.ts` | второй флаг, `runFunnelCheck`, `SELECT` внутрь транзакции | 5 |
| `app/src/components/FunnelHealthPill.tsx` | **создать** — пилюля | 6 |
| `app/src/components/FunnelHealthSection.tsx` | **создать** — секция карточки | 6 |
| `app/src/components/FunnelCard.tsx` | пилюля + пункт меню «Проверить ссылки» | 6 |
| `app/src/app/page.tsx` | загрузка состояния, чип «Только с проблемами» | 6 |
| `app/src/components/FunnelSections.tsx` | секция в конце карточки, вне режима редактирования | 6 |

Компонентных тестов в репозитории нет ни одного (`app/tests/*.tsx` пуст), поэтому задача 6 проверяется чистыми функциями, `npm run build` и живым прогоном.

---

### Task 1: Признак «комнаты нет» и канарейка

**Files:**
- Create: `app/src/lib/monitor-content.ts`
- Create: `app/src/lib/monitor-canary.ts`
- Create: `app/tests/fixtures/web-room-missing.html`
- Create: `app/tests/fixtures/web-room-live.html`
- Create: `app/tests/monitor-content.test.ts`
- Create: `app/tests/monitor-canary.test.ts`
- Modify: `app/src/lib/monitor-check.ts` (ветка после `fetch`, строки ~110–160)
- Modify: `app/src/lib/monitor-status.ts` (добавить `roomCheckLabel`)
- Modify: `app/src/app/api/monitoring/route.ts`
- Modify: `app/src/components/monitoring/MonitorSummary.tsx`
- Modify: `app/src/app/monitoring/page.tsx` (тип ответа + проброс пропа)
- Test: `app/tests/monitor-check.test.ts` (дописать кейсы)

**Interfaces:**
- Consumes: `CheckResult`, `CheckFn` из `monitor-check.ts`; `MonitorSummaryView` из `monitor-view.ts`.
- Produces:
  - `SOFT_MISSING: Record<string, { re: RegExp; reason: string }>`
  - `SOFT_MISSING_MAX_BYTES = 8192`
  - `hasSoftMissingRule(hostname: string): boolean`
  - `softMissingReason(hostname: string, head: string): string | null`
  - `CANARY_HOST = 'web.ksamatacenter.com'`, `CANARY_URL: string`
  - `type CanaryVerdict = 'ok' | 'broken' | 'unknown'`
  - `canaryVerdict(result: CheckResult): CanaryVerdict`
  - `interface CanaryView { verdict: CanaryVerdict; checkedAt: string }`
  - `getCanaryState(opts?: { check?: CheckFn; nowMs?: () => number }): Promise<CanaryView>`
  - `resetCanaryCache(): void`
  - `roomCheckLabel(verdict: CanaryVerdict): string`
  - Ответ `GET /api/monitoring` получает четвёртый ключ: `{ summary, sourceKinds, targets, roomCheck }`

- [ ] **Step 1: Снять два образца страницы и обрезать до `<head>`**

```bash
cd app
mkdir -p tests/fixtures
curl -s --max-time 20 https://web.ksamatacenter.com/room/ksamata-funnels-canary \
  | head -c 4096 > tests/fixtures/web-room-missing.html
curl -s --max-time 20 https://web.ksamatacenter.com/room/boo1-kvch \
  | head -c 4096 > tests/fixtures/web-room-live.html
grep -o '<title>[^<]*</title>' tests/fixtures/web-room-missing.html
grep -o '<title>[^<]*</title>' tests/fixtures/web-room-live.html
```

Ожидание: у первого `<title>Веб-комната не найдена</title>`, у второго — название вебинара. Если у первого заголовок другой — **остановиться**: признак изменился, и спеку надо перечитать, а не подгонять регулярку.

- [ ] **Step 2: Написать падающий тест признака**

Создать `app/tests/monitor-content.test.ts`:

```ts
/**
 * Признак «ответ 200, но за ним пусто». Образцы — настоящие страницы Bizon,
 * обрезанные до первых 4 КБ: заголовок лежит в <head>, дальше смотреть незачем.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  hasSoftMissingRule,
  softMissingReason,
  SOFT_MISSING_MAX_BYTES,
} from '../src/lib/monitor-content';

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('признак пропавшей комнаты', () => {
  it('срабатывает на странице несуществующей комнаты', () => {
    expect(softMissingReason('web.ksamatacenter.com', fixture('web-room-missing.html')))
      .toBe('Веб-комната не найдена');
  });

  it('молчит на странице живой комнаты', () => {
    expect(softMissingReason('web.ksamatacenter.com', fixture('web-room-live.html')))
      .toBeNull();
  });

  it('молчит на хосте, для которого правила нет', () => {
    expect(hasSoftMissingRule('gc.ksamata.ru')).toBe(false);
    expect(softMissingReason('gc.ksamata.ru', fixture('web-room-missing.html'))).toBeNull();
  });

  it('не принимает слова из текста страницы за заголовок', () => {
    const body = '<html><head><title>Суставы</title></head><body>Веб-комната не найдена</body></html>';
    expect(softMissingReason('web.ksamatacenter.com', body)).toBeNull();
  });

  it('бюджет чтения тела — 8 КБ', () => {
    expect(SOFT_MISSING_MAX_BYTES).toBe(8192);
  });
});
```

- [ ] **Step 3: Убедиться, что тест падает**

Run: `npx vitest run tests/monitor-content.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/monitor-content"`.

- [ ] **Step 4: Написать модуль признака**

Создать `app/src/lib/monitor-content.ts`:

```ts
/**
 * monitor-content.ts — «ответ 200, но за ним пусто».
 *
 * Чистый модуль: ни сети, ни БД, ни node:*. Его тянет monitor-check, который
 * попадает в edge-граф сборки, — любой Node-импорт здесь уронит `npm run build`,
 * оставив tsc и тесты зелёными (см. app/next.config.ts).
 *
 * Замер 18.09.2026, на котором стоит правило:
 *   web.ksamatacenter.com/room/boo1-kvch   → 200, 27250 байт, свой заголовок
 *   web.ksamatacenter.com/room/tkm1-15-rb  → 200,  2388 байт, «Веб-комната не найдена»  (F101)
 *   web.ksamatacenter.com/room/zzz-nope    → 200,  2388 байт, то же самое              (контроль)
 * Страница комнаты F101 побайтово равна выдуманному слагу — по коду ответа они
 * неразличимы, различает их только <title>.
 */
import type { CheckResult } from './monitor-check';

export interface SoftMissingRule {
  re: RegExp;
  reason: string;
}

/**
 * Хост → признак. Матчим именно <title>, а не вхождение строки в тело: живая
 * комната может законно содержать эти слова в чате или в названии вебинара.
 */
export const SOFT_MISSING: Record<string, SoftMissingRule> = {
  'web.ksamatacenter.com': {
    re: /<title>\s*Веб-комната не найдена\s*<\/title>/i,
    reason: 'Веб-комната не найдена',
  },
};

/**
 * Сколько тела читаем. <title> лежит в <head>, а вся страница-пустышка — 2,4 КБ,
 * так что 8 КБ это запас втрое, а не экономия.
 */
export const SOFT_MISSING_MAX_BYTES = 8192;

export function hasSoftMissingRule(hostname: string): boolean {
  return Object.prototype.hasOwnProperty.call(SOFT_MISSING, hostname);
}

export function softMissingReason(hostname: string, head: string): string | null {
  const rule = SOFT_MISSING[hostname];
  if (!rule) return null;
  return rule.re.test(head) ? rule.reason : null;
}

// ── Канарейка ────────────────────────────────────────────────────────────────

export const CANARY_HOST = 'web.ksamatacenter.com';

/** Слаг, который не будет заведён никогда. */
export const CANARY_URL = `https://${CANARY_HOST}/room/ksamata-funnels-canary`;

export type CanaryVerdict = 'ok' | 'broken' | 'unknown';

/**
 * Состояний три, и третье не придирка: сетевой сбой тоже даёт `down`, и выдать
 * его за «признак цел» нельзя — иначе канарейка сама станет тихим нулём.
 */
export function canaryVerdict(result: CheckResult): CanaryVerdict {
  const rule = SOFT_MISSING[CANARY_HOST];
  if (rule && result.status === 'down' && result.error === rule.reason) return 'ok';
  if (result.httpStatus !== null && result.httpStatus >= 200 && result.httpStatus < 300) {
    return 'broken';
  }
  return 'unknown';
}
```

- [ ] **Step 5: Убедиться, что тест признака проходит**

Run: `npx vitest run tests/monitor-content.test.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 6: Написать падающий тест чтения тела в `checkUrl`**

Дописать в `app/tests/monitor-check.test.ts`:

```ts
describe('признак пропавшей комнаты в checkUrl', () => {
  const missing = '<html><head><title>Веб-комната не найдена</title></head><body></body></html>';
  const live = '<html><head><title>СУСТАВЫ</title></head><body></body></html>';

  function res(body: string) {
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }

  it('200 с признаком читается как упавшая цель', async () => {
    const r = await checkUrl('https://web.ksamatacenter.com/room/zzz', {
      fetchImpl: async () => res(missing),
      lookupImpl: async () => ['203.0.113.10'],
    });
    expect(r.status).toBe('down');
    expect(r.httpStatus).toBe(200);
    expect(r.error).toBe('Веб-комната не найдена');
  });

  it('200 без признака остаётся живой целью', async () => {
    const r = await checkUrl('https://web.ksamatacenter.com/room/boo1-kvch', {
      fetchImpl: async () => res(live),
      lookupImpl: async () => ['203.0.113.10'],
    });
    expect(r.status).toBe('up');
    expect(r.error).toBe('');
  });

  it('у хоста без правила тело не читается вовсе', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode(missing)); c.close(); },
      cancel() { cancelled = true; },
    });
    const r = await checkUrl('https://gc.ksamata.ru/zzz', {
      fetchImpl: async () => new Response(body, { status: 200 }),
      lookupImpl: async () => ['203.0.113.10'],
    });
    expect(r.status).toBe('up');
    expect(cancelled).toBe(true);
  });
});
```

- [ ] **Step 7: Убедиться, что тест падает**

Run: `npx vitest run tests/monitor-check.test.ts -t 'признак пропавшей комнаты'`
Expected: FAIL — первый кейс вернёт `status: 'up'`, потому что тело сейчас рвётся всегда.

- [ ] **Step 8: Научить `checkUrl` читать голову ответа**

В `app/src/lib/monitor-check.ts` добавить импорт и функцию чтения:

```ts
import {
  hasSoftMissingRule,
  softMissingReason,
  SOFT_MISSING_MAX_BYTES,
} from './monitor-content';

/**
 * Первые maxBytes тела как текст; остаток потока рвём. Web-API, без node:*, —
 * модуль лежит в edge-графе сборки.
 */
async function readHead(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        size += value.length;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // поток уже закрыт — не наша забота
    }
  }
  const buf = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder('utf-8').decode(buf.subarray(0, maxBytes));
}
```

Заменить блок после `const latencyMs = now() - started;` — тот, где сейчас безусловно рвётся тело, — на:

```ts
      const latencyMs = now() - started;

      const location = REDIRECT_STATUSES.has(res.status)
        ? res.headers?.get('location') ?? null
        : null;

      // Тело читаем ТОЛЬКО там, где есть правило: у остальных хостов это были бы
      // лишние мегабайты на каждом цикле, ради ничего.
      const isFinalOk = location === null && res.status >= 200 && res.status < 300;
      const host = new URL(current).hostname;
      const wantsHead = isFinalOk && hasSoftMissingRule(host);
      let head = '';
      if (wantsHead) {
        head = await readHead(res, SOFT_MISSING_MAX_BYTES);
      } else {
        try {
          await res.body?.cancel();
        } catch {
          // поток уже закрыт — не наша забота
        }
      }
```

В ветке `if (res.status >= 200 && res.status < 300)` перед возвратом «живой» добавить:

```ts
      if (res.status >= 200 && res.status < 300) {
        // Ответ 200 ещё не значит, что за ним что-то есть: страница
        // несуществующей веб-комнаты отдаёт 200 и отличается только заголовком.
        const missing = wantsHead ? softMissingReason(host, head) : null;
        if (missing) {
          return {
            status: 'down',
            httpStatus: res.status,
            finalUrl: res.url || current,
            latencyMs,
            error: missing,
          };
        }
        return {
          status: latencyMs > slowMs ? 'slow' : 'up',
          httpStatus: res.status,
          finalUrl: res.url || current,
          latencyMs,
          error: '',
        };
      }
```

- [ ] **Step 9: Прогнать тесты проверки**

Run: `npx vitest run tests/monitor-check.test.ts`
Expected: PASS, включая три новых кейса и все прежние.

- [ ] **Step 10: Написать падающий тест канарейки**

Создать `app/tests/monitor-canary.test.ts`:

```ts
/**
 * Канарейка: одна и та же страница-пустышка, по которой видно, жив ли признак.
 * Сети тут нет — проверяльщик подменяется.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { canaryVerdict, CANARY_URL } from '../src/lib/monitor-content';
import { getCanaryState, resetCanaryCache, CANARY_TTL_MS } from '../src/lib/monitor-canary';
import type { CheckResult } from '../src/lib/monitor-check';

const result = (p: Partial<CheckResult>): CheckResult => ({
  status: 'up', httpStatus: 200, finalUrl: CANARY_URL, latencyMs: 10, error: '', ...p,
});

beforeEach(() => resetCanaryCache());

describe('вердикт канарейки', () => {
  it('признак сработал — «действует»', () => {
    expect(canaryVerdict(result({ status: 'down', error: 'Веб-комната не найдена' }))).toBe('ok');
  });

  it('200 без признака — «не действует»', () => {
    expect(canaryVerdict(result({ status: 'up', error: '' }))).toBe('broken');
  });

  it('сетевой сбой не выдаётся за целый признак', () => {
    expect(canaryVerdict(result({ status: 'down', httpStatus: null, error: 'Таймаут 10 с' })))
      .toBe('unknown');
  });

  it('пятисотка — тоже «не удалось проверить»', () => {
    expect(canaryVerdict(result({ status: 'down', httpStatus: 503, error: 'HTTP 503' })))
      .toBe('unknown');
  });
});

describe('кэш канарейки', () => {
  it('второй вызов подряд в сеть не идёт', async () => {
    let calls = 0;
    const check = async () => { calls += 1; return result({ status: 'down', error: 'Веб-комната не найдена' }); };
    const now = () => 1_000_000;
    expect((await getCanaryState({ check, nowMs: now })).verdict).toBe('ok');
    expect((await getCanaryState({ check, nowMs: now })).verdict).toBe('ok');
    expect(calls).toBe(1);
  });

  it('после истечения срока идёт заново', async () => {
    let calls = 0;
    const check = async () => { calls += 1; return result({ status: 'down', error: 'Веб-комната не найдена' }); };
    await getCanaryState({ check, nowMs: () => 1_000_000 });
    await getCanaryState({ check, nowMs: () => 1_000_000 + CANARY_TTL_MS + 1 });
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 11: Убедиться, что тест падает**

Run: `npx vitest run tests/monitor-canary.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/monitor-canary"`.

- [ ] **Step 12: Написать модуль канарейки**

Создать `app/src/lib/monitor-canary.ts`:

```ts
/**
 * monitor-canary.ts — жив ли признак «комнаты нет».
 *
 * Считает ЧТЕНИЕ, а не цикл. Флаг из цикла соврал бы: цикл живёт в рантайме
 * инструментации, страница рендерится в Node, общего globalThis у них нет —
 * ровно та причина, по которой monitor-view не показывает ошибки отправки в
 * Telegram. Заводить таблицу ради одного булева значения тоже незачем.
 *
 * Кэш обязателен: пока идёт цикл, страница мониторинга опрашивает роут раз в
 * две секунды, и без кэша канарейка била бы по Bizon с той же частотой.
 */
import { checkUrl, type CheckFn } from './monitor-check';
import { CANARY_URL, canaryVerdict, type CanaryVerdict } from './monitor-content';

export const CANARY_TTL_MS = 10 * 60 * 1000;

export interface CanaryView {
  verdict: CanaryVerdict;
  checkedAt: string;
}

interface CanaryCache {
  value: CanaryView;
  expiresAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __ksamataMonitorCanary: CanaryCache | undefined;
}

export async function getCanaryState(
  opts: { check?: CheckFn; nowMs?: () => number } = {},
): Promise<CanaryView> {
  const now = opts.nowMs ?? (() => Date.now());
  const cached = globalThis.__ksamataMonitorCanary;
  if (cached && cached.expiresAt > now()) return cached.value;

  const check = opts.check ?? ((url: string) => checkUrl(url));
  const result = await check(CANARY_URL);
  const value: CanaryView = {
    verdict: canaryVerdict(result),
    checkedAt: new Date(now()).toISOString(),
  };
  globalThis.__ksamataMonitorCanary = { value, expiresAt: now() + CANARY_TTL_MS };
  return value;
}

/** Только для тестов: кэш переживает файл теста, иначе кейсы влияют друг на друга. */
export function resetCanaryCache(): void {
  globalThis.__ksamataMonitorCanary = undefined;
}
```

- [ ] **Step 13: Прогнать тест канарейки**

Run: `npx vitest run tests/monitor-canary.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 14: Отдать вердикт наружу и показать в шапке**

В `app/src/lib/monitor-status.ts` дописать (модуль тянут клиентские компоненты — импорт только типа):

```ts
import type { CanaryVerdict } from './monitor-content';

/**
 * Подпись состояния проверки комнат. Живёт здесь, рядом с telegramLabel, и по
 * тому же доводу: monitor-canary тянет checkUrl, а тот — резолвер, и импорт из
 * клиентского компонента утащил бы всё это в браузерный бандл.
 */
export function roomCheckLabel(verdict: CanaryVerdict): string {
  if (verdict === 'ok') return 'Проверка комнат: действует';
  if (verdict === 'broken') return 'Проверка комнат: НЕ действует';
  return 'Проверка комнат: не удалось проверить';
}
```

В `app/src/app/api/monitoring/route.ts` заменить тело `try`:

```ts
  try {
    // roomCheck отдельным ключом, а не внутри summary: getMonitorDashboard
    // синхронна, а канарейка — сетевой вызов с кэшем.
    const [dashboard, roomCheck] = await Promise.all([
      Promise.resolve(getMonitorDashboard(db)),
      getCanaryState(),
    ]);
    return NextResponse.json({ ...dashboard, roomCheck });
  } catch (err: unknown) {
    return internalError('GET /api/monitoring', err);
  }
```

В `app/src/app/monitoring/page.tsx` расширить `DashboardData`:

```ts
interface DashboardData {
  summary: MonitorSummaryView;
  sourceKinds: MonitorSourceKindView[];
  targets: MonitorTargetView[];
  roomCheck: CanaryView;
}
```

и передать в `MonitorSummary` новым пропом `roomCheck={data.roomCheck}`.

В `app/src/components/monitoring/MonitorSummary.tsx` добавить проп и строку рядом с телеграмной:

```tsx
        {/* Признак «комнаты нет» отрицательный: протухни он — все комнаты стали
            бы «Работает», и это прочлось бы как «расхождений нет». Канарейка
            делает протухание громким. */}
        <span
          className={`text-[11px] ${
            roomCheck.verdict === 'ok' ? 'text-[var(--muted)]' : 'text-[#8A6100]'
          }`}
          title={
            roomCheck.verdict === 'ok'
              ? 'Несуществующая веб-комната опознаётся как упавшая'
              : 'Проверка «комнаты нет» не срабатывает — падения комнат могут выглядеть как «Работает»'
          }
        >
          {roomCheckLabel(roomCheck.verdict)}
        </span>
```

- [ ] **Step 15: Проверить сборку и весь сьют**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: всё зелёное. `npm run build` здесь обязателен: он единственный ловит edge-ловушку.

- [ ] **Step 16: Коммит**

```bash
git add app/src/lib/monitor-content.ts app/src/lib/monitor-canary.ts \
        app/src/lib/monitor-check.ts app/src/lib/monitor-status.ts \
        app/src/app/api/monitoring/route.ts app/src/app/monitoring/page.tsx \
        app/src/components/monitoring/MonitorSummary.tsx \
        app/tests/monitor-content.test.ts app/tests/monitor-canary.test.ts \
        app/tests/monitor-check.test.ts app/tests/fixtures
git commit -m "$(cat <<'EOF'
feat(мониторинг): «200, но за ним пусто» — признак и канарейка

Страница несуществующей веб-комнаты отдаёт 200 и отличается от живой
только заголовком, а тело мы рвали всегда — падение читалось как
«Работает». Теперь для хостов с правилом читаются первые 8 КБ.

Признак отрицательный и потому может протухнуть молча, поэтому рядом
канарейка на заведомо пустом слаге. Считает её чтение, а не цикл:
общего globalThis у цикла и страницы нет.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Комнаты как цели мониторинга

**Files:**
- Modify: `app/src/lib/monitor-kinds.ts`
- Modify: `app/src/lib/monitor-targets.ts` (`collectTargets`, `groupDefault`)
- Test: `app/tests/monitor-targets.test.ts` (дописать блок)
- Test: `app/tests/monitor-kinds.test.ts` (создать, если его нет)

**Interfaces:**
- Consumes: `normalizeUrl` из `monitor-urls.ts`; `funnelDays`, `funnels` из схемы.
- Produces:
  - `ROOM_SOURCE_KINDS = ['room_gc', 'room_web', 'room_replay'] as const`
  - `type RoomSourceKind = (typeof ROOM_SOURCE_KINDS)[number]`
  - `DEFAULT_ENABLED_SOURCE_KINDS: ReadonlySet<string>` в `monitor-targets.ts`
  - `sourceKindLabel` / `isKnownSourceKind` знают и комнаты

- [ ] **Step 1: Написать падающий тест реестра видов**

Создать `app/tests/monitor-kinds.test.ts` (если файл есть — дописать блок):

```ts
import { describe, it, expect } from 'vitest';
import { sourceKindLabel, isKnownSourceKind, ROOM_SOURCE_KINDS } from '../src/lib/monitor-kinds';

describe('реестр видов источника', () => {
  it('знает комнаты наравне с блоками', () => {
    expect(isKnownSourceKind('landings')).toBe(true);
    expect(ROOM_SOURCE_KINDS.every(isKnownSourceKind)).toBe(true);
  });

  it('подписывает комнаты по-русски', () => {
    expect(sourceKindLabel('room_gc')).toBe('Комнаты ГК');
    expect(sourceKindLabel('room_web')).toBe('Комнаты Web');
    expect(sourceKindLabel('room_replay')).toBe('Повторы');
  });

  it('незнакомый вид отдаёт сам себя, а известным не считается', () => {
    expect(sourceKindLabel('room_zzz')).toBe('room_zzz');
    expect(isKnownSourceKind('room_zzz')).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/monitor-kinds.test.ts`
Expected: FAIL — `ROOM_SOURCE_KINDS` не экспортируется.

- [ ] **Step 3: Расширить реестр видов**

В `app/src/lib/monitor-kinds.ts` заменить построение `BLOCK_TITLES` на общий реестр:

```ts
/**
 * Виды комнат. Три, а не один: это три разных хоста и три разные причины
 * падения, и только у room_web нужна проверка по содержимому. Слитая группа
 * не выключалась бы по частям.
 */
export const ROOM_SOURCE_KINDS = ['room_gc', 'room_web', 'room_replay'] as const;
export type RoomSourceKind = (typeof ROOM_SOURCE_KINDS)[number];

const ROOM_TITLES: Record<RoomSourceKind, string> = {
  room_gc: 'Комнаты ГК',
  room_web: 'Комнаты Web',
  room_replay: 'Повторы',
};

/**
 * Реестр видов источника: блоки ∪ комнаты. Раньше он выводился из одних только
 * BLOCK_KINDS — «каждая проверяемая страница приходит из блока»; с комнатами
 * это перестало быть правдой.
 */
const TITLES = new Map<string, string>([
  ...BLOCK_KINDS.map((d) => [d.kind, d.title] as [string, string]),
  ...ROOM_SOURCE_KINDS.map((k) => [k, ROOM_TITLES[k]] as [string, string]),
]);

export function sourceKindLabel(sourceKind: string): string {
  return TITLES.get(sourceKind) ?? sourceKind;
}

export function isKnownSourceKind(sourceKind: string): boolean {
  return TITLES.has(sourceKind);
}
```

Комментарий про «записывать неизвестный вид нельзя» из исходного файла **сохранить дословно** — он объясняет, почему `monitor_source_kind_prefs` нельзя засорять.

- [ ] **Step 4: Прогнать тест реестра**

Run: `npx vitest run tests/monitor-kinds.test.ts`
Expected: PASS.

- [ ] **Step 5: Написать падающий тест сбора комнат**

Дописать в `app/tests/monitor-targets.test.ts`:

```ts
describe('комнаты как цели', () => {
  /** Кладёт одну строку сетки комнат. Все прочие колонки funnel_days — по умолчанию. */
  function setRoom(funnelId: number, slot: '15' | '19', day: number,
                   gc: string, web: string, replay = '') {
    sqlite.prepare(`DELETE FROM funnel_days WHERE funnel_id = ? AND time_slot = ? AND day_num = ?`)
      .run(funnelId, slot, day);
    sqlite.prepare(
      `INSERT INTO funnel_days (funnel_id, time_slot, day_num, gc_room, web_room, replay_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(funnelId, slot, day, gc, web, replay);
  }

  function wipeRooms() {
    sqlite.prepare(`DELETE FROM funnel_days`).run();
  }

  function activeFunnelId(): number {
    return (sqlite.prepare(`SELECT id FROM funnels WHERE status = 'active' LIMIT 1`)
      .get() as { id: number }).id;
  }

  function kindOf(url: string): string | undefined {
    return (sqlite.prepare(`SELECT source_kind FROM monitor_targets WHERE url = ?`)
      .get(url) as { source_kind: string } | undefined)?.source_kind;
  }

  function enabledOf(url: string): number | undefined {
    return (sqlite.prepare(`SELECT enabled FROM monitor_targets WHERE url = ?`)
      .get(url) as { enabled: number } | undefined)?.enabled;
  }

  it('заводит цели трёх видов из сетки комнат', () => {
    wipeFunnelUrls();
    wipeRooms();
    const id = activeFunnelId();
    sqlite.prepare(`UPDATE funnels SET rooms_enabled = 1, rooms_replay_enabled = 1 WHERE id = ?`).run(id);
    setRoom(id, '15', 1,
      'https://gc.ksamata.ru/tst1-15', 'https://web.ksamatacenter.com/room/tst1-15',
      'https://gc.ksamata.ru/tst1-15r');

    syncMonitorTargets(db);

    expect(kindOf('https://gc.ksamata.ru/tst1-15')).toBe('room_gc');
    expect(kindOf('https://web.ksamatacenter.com/room/tst1-15')).toBe('room_web');
    expect(kindOf('https://gc.ksamata.ru/tst1-15r')).toBe('room_replay');
  });

  it('комнаты проверяются по умолчанию', () => {
    wipeFunnelUrls();
    wipeRooms();
    const id = activeFunnelId();
    sqlite.prepare(`UPDATE funnels SET rooms_enabled = 1 WHERE id = ?`).run(id);
    setRoom(id, '15', 1, 'https://gc.ksamata.ru/tst2-15', 'https://web.ksamatacenter.com/room/tst2-15');

    syncMonitorTargets(db);

    expect(enabledOf('https://web.ksamatacenter.com/room/tst2-15')).toBe(1);
  });

  it('воронка без эфиров комнат не отдаёт', () => {
    wipeFunnelUrls();
    wipeRooms();
    const id = activeFunnelId();
    sqlite.prepare(`UPDATE funnels SET rooms_enabled = 0 WHERE id = ?`).run(id);
    setRoom(id, '15', 1, 'https://gc.ksamata.ru/tst3-15', 'https://web.ksamatacenter.com/room/tst3-15');

    syncMonitorTargets(db);

    expect(kindOf('https://gc.ksamata.ru/tst3-15')).toBeUndefined();
  });

  it('снятый повтор не отдаёт только повтор, комнаты остаются', () => {
    wipeFunnelUrls();
    wipeRooms();
    const id = activeFunnelId();
    sqlite.prepare(`UPDATE funnels SET rooms_enabled = 1, rooms_replay_enabled = 0 WHERE id = ?`).run(id);
    setRoom(id, '15', 1,
      'https://gc.ksamata.ru/tst4-15', 'https://web.ksamatacenter.com/room/tst4-15',
      'https://gc.ksamata.ru/tst4-15r');

    syncMonitorTargets(db);

    expect(kindOf('https://gc.ksamata.ru/tst4-15')).toBe('room_gc');
    expect(kindOf('https://gc.ksamata.ru/tst4-15r')).toBeUndefined();
  });

  it('продажные группы блоков тоже включены по умолчанию', () => {
    wipeFunnelUrls();
    wipeRooms();
    const id = activeFunnelId();
    const blockId = sqlite.prepare(
      `INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, 'tariffs', 1, 'common')`
    ).run(id).lastInsertRowid as number;
    sqlite.prepare(
      `INSERT INTO funnel_block_items (block_id, slot, label, url, position) VALUES (?, NULL, '', ?, 0)`
    ).run(blockId, 'https://t.ksamata.ru/tst-tariff');

    syncMonitorTargets(db);

    expect(enabledOf('https://t.ksamata.ru/tst-tariff')).toBe(1);
  });

  it('служебные «Ссылки» по умолчанию не проверяются', () => {
    wipeFunnelUrls();
    wipeRooms();
    const id = activeFunnelId();
    const blockId = sqlite.prepare(
      `INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, 'links', 1, 'common')`
    ).run(id).lastInsertRowid as number;
    sqlite.prepare(
      `INSERT INTO funnel_block_items (block_id, slot, label, url, position) VALUES (?, NULL, 'Дашборд', ?, 0)`
    ).run(blockId, 'https://gc.ksamata.ru/dash/tst');

    syncMonitorTargets(db);

    expect(enabledOf('https://gc.ksamata.ru/dash/tst')).toBe(0);
  });
});
```

- [ ] **Step 6: Убедиться, что тесты падают**

Run: `npx vitest run tests/monitor-targets.test.ts -t 'комнаты как цели'`
Expected: FAIL — комнаты целями не становятся, `kindOf` отдаёт `undefined`.

- [ ] **Step 7: Собирать комнаты и расширить дефолт групп**

В `app/src/lib/monitor-targets.ts` добавить импорт `funnelDays` из схемы и:

```ts
/**
 * Группы, которые проверяются, пока по ним не было решения человека.
 *
 * До 18.09.2026 здесь был один `landings`. Набор расширен до того, что видит
 * клиент и что стоит денег, плюс комнаты: молчание пилюли воронки иначе
 * означало бы «в проверяемом всё живо», а читалось бы как «всё живо».
 * Служебные `links` и `processes` остаются выключенными — их включают руками.
 */
export const DEFAULT_ENABLED_SOURCE_KINDS: ReadonlySet<string> = new Set([
  'landings',
  'tariffs',
  'applications',
  'upsell',
  'room_gc',
  'room_web',
  'room_replay',
]);
```

Заменить хвост `groupDefault`:

```ts
function groupDefault(prefs: Map<string, boolean>, sourceKind: string): 0 | 1 {
  const pref = prefs.get(sourceKind);
  if (pref !== undefined) return pref ? 1 : 0;
  return DEFAULT_ENABLED_SOURCE_KINDS.has(sourceKind) ? 1 : 0;
}
```

В `collectTargets`, после цикла по `items`, добавить второй источник:

```ts
  // Второй источник — сетка комнат. Комнаты живут не в блоках, а в funnel_days,
  // и до 18.09.2026 в мониторинг не попадали вовсе: у F101 из-за этого
  // несуществующие комнаты были невидимы.
  const rooms = db
    .select({
      funnelId: funnelDays.funnelId,
      gcRoom: funnelDays.gcRoom,
      webRoom: funnelDays.webRoom,
      replayUrl: funnelDays.replayUrl,
      roomsEnabled: funnels.roomsEnabled,
      replayEnabled: funnels.roomsReplayEnabled,
    })
    .from(funnelDays)
    .innerJoin(funnels, eq(funnels.id, funnelDays.funnelId))
    .where(inArray(funnels.status, [...statuses]))
    .all() as {
      funnelId: number;
      gcRoom: string | null;
      webRoom: string | null;
      replayUrl: string | null;
      roomsEnabled: number | null;
      replayEnabled: number | null;
    }[];

  const addRoom = (raw: string | null, kind: string, funnelId: number) => {
    const url = normalizeUrl(raw ?? '');
    if (url) add(url, kind, funnelId);
  };

  for (const row of rooms) {
    // rooms_enabled = 0 — решение человека «здесь нет эфиров». Его уже уважают
    // карточка, компактный вид и buildExportRows; мониторинг обязан читать
    // данные так же, иначе он видит то, чего для сервиса не существует.
    if (row.roomsEnabled === 1) {
      addRoom(row.gcRoom, 'room_gc', row.funnelId);
      addRoom(row.webRoom, 'room_web', row.funnelId);
    }
    if (row.replayEnabled === 1) {
      addRoom(row.replayUrl, 'room_replay', row.funnelId);
    }
  }
```

- [ ] **Step 8: Прогнать тесты синка**

Run: `npx vitest run tests/monitor-targets.test.ts`
Expected: PASS. Если покраснел старый кейс про «остальное выключено» — он опирался на прежний дефолт «только ленды»; поправить ожидание на `DEFAULT_ENABLED_SOURCE_KINDS`, но **не** ослаблять проверку для `links`.

- [ ] **Step 9: Весь сьют и типы**

Run: `npx tsc --noEmit && npx vitest run`
Expected: зелено.

- [ ] **Step 10: Коммит**

```bash
git add app/src/lib/monitor-kinds.ts app/src/lib/monitor-targets.ts \
        app/tests/monitor-kinds.test.ts app/tests/monitor-targets.test.ts
git commit -m "$(cat <<'EOF'
feat(мониторинг): комнаты становятся целями, дефолт групп шире

collectTargets читал только funnel_block_items, поэтому 920 адресов
вебинарных комнат не проверялись вовсе. Теперь сетка комнат даёт три
вида источника: room_gc, room_web, room_replay.

Дефолт групп расширен с одних лендингов до того, что видит клиент:
+ тарифы, заявки, допродажи и комнаты. Решения человека в
monitor_source_kind_prefs по-прежнему главнее дефолта.

Воронка с rooms_enabled = 0 комнат не отдаёт — это решение человека
«здесь нет эфиров», и мониторинг читает данные так же, как карточка.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Связи по всем статусам, `usage` из связей

**Files:**
- Modify: `app/src/lib/monitor-targets.ts` (`Collected`, `collectTargets`, `syncMonitorTargets`, `collectFunnelUrls`)
- Modify: `app/src/lib/monitor-view.ts` (`funnelsByTarget`, `getMonitorDashboard`)
- Test: `app/tests/monitor-targets.test.ts`, `app/tests/monitor-view.test.ts`

**Interfaces:**
- Consumes: `FUNNEL_STATUS_VALUES` из `status.ts`.
- Produces:
  - `collectTargets` собирает по всем статусам, каждая запись знает `hasActive: boolean`
  - `funnelsByTarget(db, targetIds?)` отдаёт `MonitorFunnelRefWithStatus[]` (`MonitorFunnelRef & { status: FunnelStatus }`)
  - `collectFunnelUrls` удаляется вместе с её тестами: единственный потребитель — `monitor-view`, и он перестаёт быть ей нужен

- [ ] **Step 1: Написать падающий тест новой семантики связей**

Дописать в `app/tests/monitor-targets.test.ts`:

```ts
describe('связи и включённость разведены', () => {
  function funnelsOf(url: string): number[] {
    return (sqlite.prepare(
      `SELECT f.funnel_id AS id FROM monitor_target_funnels f
         JOIN monitor_targets t ON t.id = f.target_id WHERE t.url = ?`
    ).all(url) as { id: number }[]).map((r) => r.id);
  }

  it('адрес черновика получает цель и связь, но не проверяется', () => {
    wipeFunnelUrls();
    const draftId = (sqlite.prepare(`SELECT id FROM funnels WHERE status = 'draft' LIMIT 1`)
      .get() as { id: number } | undefined)?.id;
    expect(draftId, 'в копии базы нужен хотя бы один черновик').toBeDefined();
    setLanding(draftId!, 'https://lp.example.ru/draft-only');

    syncMonitorTargets(db);

    const row = sqlite.prepare(`SELECT enabled FROM monitor_targets WHERE url = ?`)
      .get('https://lp.example.ru/draft-only') as { enabled: number } | undefined;
    expect(row?.enabled).toBe(0);
    expect(funnelsOf('https://lp.example.ru/draft-only')).toEqual([draftId]);
  });

  it('адрес, который держат активная и архивная, проверяется и связан с обеими', () => {
    wipeFunnelUrls();
    const active = (sqlite.prepare(`SELECT id FROM funnels WHERE status = 'active' LIMIT 1`)
      .get() as { id: number }).id;
    const archived = (sqlite.prepare(`SELECT id FROM funnels WHERE status = 'archive' LIMIT 1`)
      .get() as { id: number }).id;
    setLanding(active, 'https://lp.example.ru/shared');
    setLanding(archived, 'https://lp.example.ru/shared');

    syncMonitorTargets(db);

    const row = sqlite.prepare(`SELECT enabled FROM monitor_targets WHERE url = ?`)
      .get('https://lp.example.ru/shared') as { enabled: number };
    expect(row.enabled).toBe(1);
    expect(funnelsOf('https://lp.example.ru/shared').sort()).toEqual([active, archived].sort());
  });

  it('адрес, которого нет уже ни у кого, отвязывается и гаснет', () => {
    wipeFunnelUrls();
    const active = (sqlite.prepare(`SELECT id FROM funnels WHERE status = 'active' LIMIT 1`)
      .get() as { id: number }).id;
    setLanding(active, 'https://lp.example.ru/will-vanish');
    syncMonitorTargets(db);

    setLanding(active);
    syncMonitorTargets(db);

    const row = sqlite.prepare(`SELECT enabled FROM monitor_targets WHERE url = ?`)
      .get('https://lp.example.ru/will-vanish') as { enabled: number };
    expect(row.enabled).toBe(0);
    expect(funnelsOf('https://lp.example.ru/will-vanish')).toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/monitor-targets.test.ts -t 'связи и включённость разведены'`
Expected: FAIL — у черновика цель не заводится вовсе, `funnelsOf` пуст.

- [ ] **Step 3: Развести сбор и включённость**

В `app/src/lib/monitor-targets.ts`:

```ts
import { FUNNEL_STATUS_VALUES } from './status';

interface Collected {
  url: string;
  sourceKind: string;
  funnelIds: Set<number>;
  /** Держит ли адрес хотя бы одна активная воронка — от этого зависит enabled. */
  hasActive: boolean;
}
```

`collectTargets` собирает по всем статусам по умолчанию и помечает активность:

```ts
function collectTargets(
  db: AnyDB,
  statuses: readonly string[] = FUNNEL_STATUS_VALUES,
): Map<string, Collected> {
  const out = new Map<string, Collected>();

  const add = (url: string, sourceKind: string, funnelId: number, isActive: boolean) => {
    const existing = out.get(url);
    if (!existing) {
      out.set(url, { url, sourceKind, funnelIds: new Set([funnelId]), hasActive: isActive });
      return;
    }
    existing.funnelIds.add(funnelId);
    if (isActive) existing.hasActive = true;
    if (sourceRank(sourceKind) < sourceRank(existing.sourceKind)) {
      existing.sourceKind = sourceKind;
    }
  };
  // …обе выборки добавляют `status` в select и зовут
  // add(url, kind, funnelId, row.status === MONITORED_FUNNEL_STATUS)
}
```

В `syncMonitorTargets` заменить оба места, где считается `enabled`:

```ts
  const collected = collectTargets(db);
```

и внутри цикла — `groupDefault(prefs, item.sourceKind) && item.hasActive`:

```ts
      // Правило «мониторим только активные» не отменено — оно переехало со
      // сбора на включение. Связь говорит «кто держит адрес», enabled —
      // «проверяем ли». Иначе ручная проверка черновика гасла бы на ближайшем
      // фоновом прогоне: синк отвязывал бы его цель.
      const wanted: 0 | 1 = item.hasActive ? groupDefault(prefs, item.sourceKind) : 0;
```

и подставить `wanted` и в ветку `existing` (при `manualOverride === 0`), и во `values` вставки.

Удалить экспорт `collectFunnelUrls` целиком.

- [ ] **Step 4: Прогнать тесты синка**

Run: `npx vitest run tests/monitor-targets.test.ts`
Expected: PASS. Кейсы авто-ретайрмента могли опираться на «отвязываем всё, чего нет у активных» — привести к новому правилу «отвязываем только ничьё».

- [ ] **Step 5: Написать падающий тест `usage` из связей**

Дописать в `app/tests/monitor-view.test.ts`:

```ts
describe('чей адрес — читается из связей', () => {
  it('адрес только архивной воронки помечен как inactive и не идёт в счёт группы', () => {
    // цель, связанная с архивной воронкой и погашенная синком
    const archived = (sqlite.prepare(`SELECT id, front_code FROM funnels WHERE status = 'archive' LIMIT 1`)
      .get() as { id: number; front_code: string });
    const targetId = sqlite.prepare(
      `INSERT INTO monitor_targets (url, source_kind, enabled) VALUES (?, 'landings', 0)`
    ).run('https://lp.example.ru/archived').lastInsertRowid as number;
    sqlite.prepare(`INSERT INTO monitor_target_funnels (target_id, funnel_id) VALUES (?, ?)`)
      .run(targetId, archived.id);
    sqlite.prepare(`INSERT INTO monitor_state (target_id, status) VALUES (?, 'unknown')`).run(targetId);

    const { targets, sourceKinds } = getMonitorDashboard(db);
    const t = targets.find((x) => x.url === 'https://lp.example.ru/archived')!;
    expect(t.usage).toBe('inactive');
    expect(t.funnels).toEqual([]);
    expect(t.inactiveFunnels.map((f) => f.frontCode)).toEqual([archived.front_code]);
    expect(sourceKinds.find((k) => k.sourceKind === 'landings')?.total ?? 0).toBe(0);
  });

  it('цель без единой связи — orphan', () => {
    const targetId = sqlite.prepare(
      `INSERT INTO monitor_targets (url, source_kind, enabled) VALUES (?, 'landings', 0)`
    ).run('https://lp.example.ru/nobody').lastInsertRowid as number;
    sqlite.prepare(`INSERT INTO monitor_state (target_id, status) VALUES (?, 'unknown')`).run(targetId);

    const t = getMonitorDashboard(db).targets.find((x) => x.url === 'https://lp.example.ru/nobody')!;
    expect(t.usage).toBe('orphan');
  });
});
```

- [ ] **Step 6: Убедиться, что тест падает**

Run: `npx vitest run tests/monitor-view.test.ts -t 'чей адрес'`
Expected: FAIL — сегодня связь с архивной воронкой попала бы в `t.funnels`, и `usage` вышел бы `active`.

- [ ] **Step 7: Считать `usage` из связей**

В `app/src/lib/monitor-view.ts`:

- убрать импорт `collectFunnelUrls` и функцию `funnelRefsById`, а также `INACTIVE_FUNNEL_STATUSES`;
- `funnelsByTarget` добавляет `status` в `select` и возвращает `MonitorInactiveFunnelRef[]` (тип уже есть — `MonitorFunnelRef & { status }`);
- в `getMonitorDashboard` разложить связи на две группы:

```ts
    const linked = links.get(r.id) ?? [];
    // «Кто держит адрес» теперь знает и статус держателя, поэтому пересобирать
    // URL неактивных воронок больше не нужно — раньше это был обходной путь
    // ровно потому, что связи хранились только для активных.
    const activeFunnels = linked.filter((f) => f.status === MONITORED_FUNNEL_STATUS);
    const heldBy = linked.filter((f) => f.status !== MONITORED_FUNNEL_STATUS);
    const usage: MonitorTargetUsage =
      activeFunnels.length > 0 ? 'active' : heldBy.length > 0 ? 'inactive' : 'orphan';
```

и дальше `funnels: activeFunnels.map(({ status, ...ref }) => ref)`, `inactiveFunnels: heldBy`.

- [ ] **Step 8: Прогнать тесты дашборда**

Run: `npx vitest run tests/monitor-view.test.ts`
Expected: PASS.

- [ ] **Step 9: Убрать тесты удалённой функции и прогнать всё**

Run: `npx vitest run 2>&1 | tail -30`
Expected: зелено. Тесты, импортировавшие `collectFunnelUrls`, удалить — функции больше нет; её поведение теперь закреплено кейсами `usage`.

Run: `npx tsc --noEmit`

- [ ] **Step 10: Коммит**

```bash
git add app/src/lib/monitor-targets.ts app/src/lib/monitor-view.ts \
        app/tests/monitor-targets.test.ts app/tests/monitor-view.test.ts
git commit -m "$(cat <<'EOF'
refactor(мониторинг): связь — «кто держит адрес», enabled — «проверяем ли»

monitor_target_funnels хранил связи только активных воронок, а синк
отвязывал всё прочее. Из-за этого результат ручной проверки черновика
гас бы на ближайшем фоновом прогоне, без объяснения.

Теперь цели и связи собираются по всем статусам, а enabled считается как
«дефолт группы И адрес держит хотя бы одна активная воронка».
Отвязывается только адрес, которого нет уже ни у кого.

Побочно упростился дашборд: usage читается из связей, и пересборка URL
неактивных воронок (collectFunnelUrls) больше не нужна.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Агрегат состояния воронки и роуты чтения

**Files:**
- Create: `app/src/lib/monitor-funnel-health.ts`
- Create: `app/src/app/api/monitoring/funnels/route.ts`
- Create: `app/src/app/api/monitoring/funnels/[id]/route.ts`
- Create: `app/tests/monitor-funnel-health.test.ts`
- Create: `app/tests/api-monitoring-funnels-route.test.ts`
- Modify: `app/src/lib/monitor-status.ts` (вынести `parseSqliteUtc`)

**Interfaces:**
- Consumes: `monitorTargetFunnels`, `monitorTargets`, `monitorState` из схемы; `sourceKindLabel`.
- Produces:
  - `STALE_AFTER_DAYS = 7`
  - `interface FunnelHealth { down: number; unknown: number; enabled: number; total: number; lastCheckedAt: string | null }`
  - `type FunnelHealthTone = 'down' | 'unknown' | 'ok'`
  - `funnelHealthTone(h: FunnelHealth): FunnelHealthTone`
  - `getFunnelHealth(db: AnyDB, funnelIds?: number[], nowMs?: number): Map<number, FunnelHealth>`
  - `interface FunnelProblem { url: string; origin: string; status: MonitorStatus; httpStatus: number | null; error: string; since: string | null; checkedAt: string | null; enabled: boolean }`
  - `listFunnelProblems(db: AnyDB, funnelId: number, nowMs?: number): FunnelProblem[]`
  - `collectFunnelOrigins(db: AnyDB, funnelId: number): Map<string, string>`
  - `parseSqliteUtc(iso: string | null): number | null` в `monitor-status.ts`
  - `GET /api/monitoring/funnels` → `{ health: Record<string, FunnelHealth> }`
  - `GET /api/monitoring/funnels/[id]` → `{ health: FunnelHealth; problems: FunnelProblem[]; checking: boolean }`

- [ ] **Step 1: Написать падающий тест агрегата**

Создать `app/tests/monitor-funnel-health.test.ts`:

```ts
/**
 * Состояние воронки. Цели и статусы заводим руками: проверяется правило
 * агрегации, а не сбор.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase6 } from '../scripts/migrate-phase6';
import * as schema from '../src/db/schema';
import { clearMonitoringState } from './helpers/monitoring';
import { copyDbForTest } from './helpers/db';
import {
  getFunnelHealth,
  funnelHealthTone,
  STALE_AFTER_DAYS,
} from '../src/lib/monitor-funnel-health';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
const NOW = Date.parse('2026-09-18T12:00:00Z');
let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let funnelId: number;

/** SQLite пишет UTC без зоны: 'YYYY-MM-DD HH:MM:SS'. */
function sqliteTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function addTarget(url: string, enabled: 0 | 1, status: string | null, checkedAtMs: number | null) {
  const id = sqlite.prepare(
    `INSERT INTO monitor_targets (url, source_kind, enabled) VALUES (?, 'landings', ?)`
  ).run(url, enabled).lastInsertRowid as number;
  sqlite.prepare(`INSERT INTO monitor_target_funnels (target_id, funnel_id) VALUES (?, ?)`)
    .run(id, funnelId);
  if (status !== null) {
    sqlite.prepare(`INSERT INTO monitor_state (target_id, status, checked_at) VALUES (?, ?, ?)`)
      .run(id, status, checkedAtMs === null ? null : sqliteTime(checkedAtMs));
  }
  return id;
}

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `fh-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  copyDbForTest(REAL_DB, tmp);
  sqlite = new Database(tmp);
  sqlite.pragma('foreign_keys = ON');
  runMigratePhase6(sqlite);
  clearMonitoringState(sqlite);
  db = drizzle(sqlite, { schema });
  funnelId = (sqlite.prepare(`SELECT id FROM funnels WHERE status = 'active' LIMIT 1`)
    .get() as { id: number }).id;
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

describe('состояние воронки', () => {
  it('считает свежие падения', () => {
    addTarget('https://lp.example.ru/a', 1, 'down', NOW - 60_000);
    addTarget('https://lp.example.ru/b', 1, 'up', NOW - 60_000);

    const h = getFunnelHealth(db, [funnelId], NOW).get(funnelId)!;
    expect(h.down).toBe(1);
    expect(h.enabled).toBe(2);
    expect(h.total).toBe(2);
    expect(funnelHealthTone(h)).toBe('down');
  });

  it('падение старше недели пилюлю не зажигает', () => {
    const old = NOW - (STALE_AFTER_DAYS + 1) * 86_400_000;
    addTarget('https://lp.example.ru/stale', 1, 'down', old);

    const h = getFunnelHealth(db, [funnelId], NOW).get(funnelId)!;
    expect(h.down).toBe(0);
    expect(funnelHealthTone(h)).toBe('ok');
  });

  it('выключенная цель в падении всё равно считается', () => {
    addTarget('https://lp.example.ru/off', 0, 'down', NOW - 60_000);

    const h = getFunnelHealth(db, [funnelId], NOW).get(funnelId)!;
    expect(h.down).toBe(1);
    expect(h.enabled).toBe(0);
  });

  it('выключенная непроверенная цель пробелом не считается', () => {
    addTarget('https://lp.example.ru/never-off', 0, 'unknown', null);

    const h = getFunnelHealth(db, [funnelId], NOW).get(funnelId)!;
    expect(h.unknown).toBe(0);
    expect(funnelHealthTone(h)).toBe('ok');
  });

  it('включённая непроверенная цель даёт «не проверялось»', () => {
    addTarget('https://lp.example.ru/never-on', 1, 'unknown', null);

    const h = getFunnelHealth(db, [funnelId], NOW).get(funnelId)!;
    expect(h.unknown).toBe(1);
    expect(funnelHealthTone(h)).toBe('unknown');
  });

  it('падение важнее непроверенного', () => {
    addTarget('https://lp.example.ru/x', 1, 'down', NOW - 60_000);
    addTarget('https://lp.example.ru/y', 1, 'unknown', null);

    expect(funnelHealthTone(getFunnelHealth(db, [funnelId], NOW).get(funnelId)!)).toBe('down');
  });

  it('пустой список воронок не строит запрос', () => {
    expect(getFunnelHealth(db, [], NOW).size).toBe(0);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/monitor-funnel-health.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Вынести разбор времени SQLite**

В `app/src/lib/monitor-status.ts` добавить перед `formatAgo`:

```ts
/**
 * Время из SQLite (`datetime('now')` → 'YYYY-MM-DD HH:MM:SS' в UTC, без зоны)
 * в миллисекунды. Пробел меняем на 'T' и дописываем 'Z': иначе движок сочтёт
 * строку локальным временем и сдвинет результат на часовой пояс.
 */
export function parseSqliteUtc(iso: string | null): number | null {
  if (!iso) return null;
  const normalized = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
  const then = Date.parse(normalized);
  return Number.isNaN(then) ? null : then;
}
```

и переписать начало `formatAgo` на неё:

```ts
export function formatAgo(iso: string | null, nowMs: number = Date.now()): string {
  const then = parseSqliteUtc(iso);
  if (then === null) return 'никогда';
  const seconds = Math.max(0, Math.floor((nowMs - then) / 1000));
  // …дальше без изменений
```

- [ ] **Step 4: Написать модуль агрегата**

Создать `app/src/lib/monitor-funnel-health.ts`:

```ts
/**
 * monitor-funnel-health.ts — состояние ссылок одной воронки. Только чтение.
 *
 * Считается при чтении, а не хранится: новых таблиц у фичи нет, а связка
 * monitor_target_funnels → monitor_targets → monitor_state и есть ответ.
 */
import { eq, inArray } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import {
  funnelBlockItems,
  funnelBlocks,
  funnelDays,
  monitorState,
  monitorTargetFunnels,
  monitorTargets,
} from '../db/schema';
import { isMonitorStatus, parseSqliteUtc, type MonitorStatus } from './monitor-status';
import { sourceKindLabel } from './monitor-kinds';
import { normalizeUrl } from './monitor-urls';

/**
 * Насколько старое падение ещё зажигает пилюлю.
 *
 * Отсечка и даёт тишину у архива: его страницы мертвы законно, это и значит
 * «архив». Активную воронку правило не задевает — её проверяют каждые 15 минут;
 * черновик после ручной проверки светится неделю.
 */
export const STALE_AFTER_DAYS = 7;

export interface FunnelHealth {
  down: number;
  unknown: number;
  enabled: number;
  total: number;
  lastCheckedAt: string | null;
}

export type FunnelHealthTone = 'down' | 'unknown' | 'ok';

export function funnelHealthTone(h: FunnelHealth): FunnelHealthTone {
  if (h.down > 0) return 'down';
  if (h.unknown > 0) return 'unknown';
  return 'ok';
}

export interface FunnelProblem {
  url: string;
  origin: string;
  status: MonitorStatus;
  httpStatus: number | null;
  error: string;
  since: string | null;
  checkedAt: string | null;
  enabled: boolean;
}

interface Row {
  funnelId: number;
  url: string;
  enabled: number;
  status: string | null;
  httpStatus: number | null;
  error: string | null;
  since: string | null;
  checkedAt: string | null;
}

function rowsFor(db: AnyDB, funnelIds?: number[]): Row[] {
  const base = db
    .select({
      funnelId: monitorTargetFunnels.funnelId,
      url: monitorTargets.url,
      enabled: monitorTargets.enabled,
      status: monitorState.status,
      httpStatus: monitorState.httpStatus,
      error: monitorState.error,
      since: monitorState.since,
      checkedAt: monitorState.checkedAt,
    })
    .from(monitorTargetFunnels)
    .innerJoin(monitorTargets, eq(monitorTargets.id, monitorTargetFunnels.targetId))
    .leftJoin(monitorState, eq(monitorState.targetId, monitorTargets.id));

  return (
    funnelIds ? base.where(inArray(monitorTargetFunnels.funnelId, funnelIds)) : base
  ).all() as Row[];
}

/** Свежее ли падение: старше отсечки — уже не новость. */
function isFreshDown(row: Row, staleBeforeMs: number): boolean {
  if (row.status !== 'down') return false;
  const checkedAt = parseSqliteUtc(row.checkedAt);
  return checkedAt !== null && checkedAt >= staleBeforeMs;
}

export function getFunnelHealth(
  db: AnyDB,
  funnelIds?: number[],
  nowMs: number = Date.now(),
): Map<number, FunnelHealth> {
  // IN () без аргументов — известная ловушка SQL; на пустом списке не строим запрос.
  if (funnelIds && funnelIds.length === 0) return new Map();

  const staleBefore = nowMs - STALE_AFTER_DAYS * 86_400_000;
  const out = new Map<number, FunnelHealth>();

  for (const row of rowsFor(db, funnelIds)) {
    const h =
      out.get(row.funnelId) ??
      { down: 0, unknown: 0, enabled: 0, total: 0, lastCheckedAt: null as string | null };

    h.total += 1;
    if (row.enabled === 1) h.enabled += 1;
    if (isFreshDown(row, staleBefore)) h.down += 1;
    // Непроверенная ВЫКЛЮЧЕННАЯ цель пробелом не считается: её никто и не
    // обещал проверять, иначе у каждого архива висела бы серая пилюля.
    if (row.enabled === 1 && (row.status === null || row.status === 'unknown')) h.unknown += 1;
    if (row.checkedAt && (!h.lastCheckedAt || row.checkedAt > h.lastCheckedAt)) {
      h.lastCheckedAt = row.checkedAt;
    }

    out.set(row.funnelId, h);
  }

  return out;
}

/**
 * Откуда у воронки взялся адрес: «Комнаты ГК · 15:00 · день 2», «Тарифы · Основной».
 *
 * Считается при чтении, а не колонкой в monitor_targets: один адрес может
 * принадлежать двум воронкам с разным происхождением, и колонка была бы
 * неверна по существу.
 */
export function collectFunnelOrigins(db: AnyDB, funnelId: number): Map<string, string> {
  const out = new Map<string, string>();

  const items = db
    .select({
      kind: funnelBlocks.kind,
      label: funnelBlockItems.label,
      slot: funnelBlockItems.slot,
      url: funnelBlockItems.url,
    })
    .from(funnelBlockItems)
    .innerJoin(funnelBlocks, eq(funnelBlocks.id, funnelBlockItems.blockId))
    .where(eq(funnelBlocks.funnelId, funnelId))
    .all() as { kind: string; label: string | null; slot: string | null; url: string }[];

  for (const item of items) {
    const url = normalizeUrl(item.url);
    if (!url || out.has(url)) continue;
    const parts = [sourceKindLabel(item.kind)];
    if (item.label?.trim()) parts.push(item.label.trim());
    if (item.slot) parts.push(`${item.slot}:00`);
    out.set(url, parts.join(' · '));
  }

  const days = db
    .select({
      slot: funnelDays.timeSlot,
      day: funnelDays.dayNum,
      gcRoom: funnelDays.gcRoom,
      webRoom: funnelDays.webRoom,
      replayUrl: funnelDays.replayUrl,
    })
    .from(funnelDays)
    .where(eq(funnelDays.funnelId, funnelId))
    .all() as {
      slot: string; day: number;
      gcRoom: string | null; webRoom: string | null; replayUrl: string | null;
    }[];

  for (const d of days) {
    const where = `${d.slot}:00 · день ${d.day}`;
    for (const [raw, kind] of [
      [d.gcRoom, 'room_gc'],
      [d.webRoom, 'room_web'],
      [d.replayUrl, 'room_replay'],
    ] as const) {
      const url = normalizeUrl(raw ?? '');
      if (url && !out.has(url)) out.set(url, `${sourceKindLabel(kind)} · ${where}`);
    }
  }

  return out;
}

/** Проблемные адреса воронки, «Упало» первыми, затем непроверенные. */
export function listFunnelProblems(
  db: AnyDB,
  funnelId: number,
  nowMs: number = Date.now(),
): FunnelProblem[] {
  const staleBefore = nowMs - STALE_AFTER_DAYS * 86_400_000;
  const origins = collectFunnelOrigins(db, funnelId);

  const problems: FunnelProblem[] = [];
  for (const row of rowsFor(db, [funnelId])) {
    const fresh = isFreshDown(row, staleBefore);
    const never = row.enabled === 1 && (row.status === null || row.status === 'unknown');
    if (!fresh && !never) continue;
    problems.push({
      url: row.url,
      origin: origins.get(row.url) ?? 'Источник не найден',
      status: isMonitorStatus(row.status) ? row.status : 'unknown',
      httpStatus: row.httpStatus,
      error: row.error ?? '',
      since: row.since,
      checkedAt: row.checkedAt,
      enabled: row.enabled === 1,
    });
  }

  return problems.sort((a, b) => {
    const byStatus = (a.status === 'down' ? 0 : 1) - (b.status === 'down' ? 0 : 1);
    return byStatus !== 0 ? byStatus : a.url.localeCompare(b.url);
  });
}
```

- [ ] **Step 5: Прогнать тест агрегата**

Run: `npx vitest run tests/monitor-funnel-health.test.ts`
Expected: PASS, 7 тестов.

- [ ] **Step 6: Написать падающий тест роутов чтения**

Создать `app/tests/api-monitoring-funnels-route.test.ts` по образцу `tests/api-monitoring-route.test.ts` (тот же способ поднимать окружение и звать обработчик напрямую):

```ts
describe('GET /api/monitoring/funnels', () => {
  it('анониму — 401', async () => {
    const res = await GET(makeRequest('http://localhost/api/monitoring/funnels'));
    expect(res.status).toBe(401);
  });

  it('редактору отдаёт состояние по id воронки', async () => {
    const res = await GET(editorRequest('http://localhost/api/monitoring/funnels'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('health');
  });
});

describe('GET /api/monitoring/funnels/[id]', () => {
  it('нечисловой id — 400', async () => {
    const res = await GET_ONE(editorRequest('http://localhost/api/monitoring/funnels/f101'), {
      params: Promise.resolve({ id: 'f101' }),
    });
    expect(res.status).toBe(400);
  });

  it('несуществующая воронка — 404', async () => {
    const res = await GET_ONE(editorRequest('http://localhost/api/monitoring/funnels/999999'), {
      params: Promise.resolve({ id: '999999' }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 7: Убедиться, что тест падает**

Run: `npx vitest run tests/api-monitoring-funnels-route.test.ts`
Expected: FAIL — роутов нет.

- [ ] **Step 8: Написать роуты**

`app/src/app/api/monitoring/funnels/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { getFunnelHealth } from '@/lib/monitor-funnel-health';
import { runningFunnelCheckId } from '@/lib/monitor-run';
import { internalError } from '@/lib/http';
import { requireEditor } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/**
 * Состояние ссылок всех воронок — отдельным роутом, а не полем в /api/funnels:
 * тот лежит в белом списке публичного чтения, и мониторинг стал бы публичным.
 */
export async function GET(req: NextRequest) {
  const denied = await requireEditor(req);
  if (denied) return denied;

  try {
    const health = Object.fromEntries(getFunnelHealth(db));
    return NextResponse.json({ health, checkingFunnelId: runningFunnelCheckId() });
  } catch (err: unknown) {
    return internalError('GET /api/monitoring/funnels', err);
  }
}
```

`app/src/app/api/monitoring/funnels/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { getFunnelHealth, listFunnelProblems } from '@/lib/monitor-funnel-health';
import { runningFunnelCheckId } from '@/lib/monitor-run';
import { funnelExists } from '@/lib/funnel-days';
import { parseRouteId } from '@/lib/validation';
import { internalError } from '@/lib/http';
import { requireEditor } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const EMPTY = { down: 0, unknown: 0, enabled: 0, total: 0, lastCheckedAt: null };

export async function GET(req: NextRequest, { params }: Params) {
  const denied = await requireEditor(req);
  if (denied) return denied;

  const { id } = await params;
  const numId = parseRouteId(id);
  if (numId === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!funnelExists(db, numId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    return NextResponse.json({
      // Воронка без единой цели — законное состояние (пустой черновик), и
      // пустой агрегат честнее отсутствующего ключа.
      health: getFunnelHealth(db, [numId]).get(numId) ?? EMPTY,
      problems: listFunnelProblems(db, numId),
      checking: runningFunnelCheckId() === numId,
    });
  } catch (err: unknown) {
    return internalError('GET /api/monitoring/funnels/[id]', err);
  }
}
```

`runningFunnelCheckId` появится в задаче 5; чтобы задача 4 собиралась сама по себе, добавить в `app/src/lib/monitor-run.ts` заглушку-контракт сразу:

```ts
/** id воронки, которую проверяют прямо сейчас, или null. Наполняется в runFunnelCheck. */
export function runningFunnelCheckId(): number | null {
  return runState().funnelCheckId ?? null;
}
```

и расширить `MonitorRunState`:

```ts
interface MonitorRunState {
  cycleRunning: boolean;
  /** Воронка, которую проверяют вручную. null — ручной проверки нет. */
  funnelCheckId?: number | null;
}
```

- [ ] **Step 9: Прогнать тесты роутов и весь сьют**

Run: `npx vitest run tests/api-monitoring-funnels-route.test.ts && npx tsc --noEmit && npx vitest run`
Expected: зелено.

- [ ] **Step 10: Коммит**

```bash
git add app/src/lib/monitor-funnel-health.ts app/src/lib/monitor-status.ts \
        app/src/lib/monitor-run.ts app/src/app/api/monitoring/funnels \
        app/tests/monitor-funnel-health.test.ts app/tests/api-monitoring-funnels-route.test.ts
git commit -m "$(cat <<'EOF'
feat(мониторинг): состояние ссылок воронки и роуты чтения

Агрегат считается при чтении из monitor_target_funnels + monitor_state,
новых таблиц нет. Падение считается, даже если цель выключена: человек
сам попросил проверить. Непроверенной считается только ВКЛЮЧЁННАЯ цель —
иначе у каждого архива висела бы серая пилюля.

Падение старше недели пилюлю не зажигает: страницы архива мертвы
законно, и это как раз значит «архив».

Отдельный роут, а не поле в /api/funnels: тот в белом списке публичного
чтения, и мониторинг стал бы публичным.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Ручная проверка одной воронки

**Files:**
- Modify: `app/src/lib/monitor-targets.ts` (`syncFunnelTargets`)
- Modify: `app/src/lib/monitor-run.ts` (`persist`, `runFunnelCheck`, второй флаг)
- Create: `app/src/app/api/monitoring/funnels/[id]/run/route.ts`
- Test: `app/tests/monitor-run.test.ts`, `app/tests/api-monitoring-funnels-route.test.ts`

**Interfaces:**
- Consumes: `checkWithRetry`, `persist`, `CycleOptions` из `monitor-run.ts`.
- Produces:
  - `syncFunnelTargets(db: AnyDB, funnelId: number): void`
  - `runFunnelCheck(db: AnyDB, funnelId: number, opts?: CycleOptions): Promise<CycleResult | null>` — `null`, если ручная проверка уже идёт
  - `runningFunnelCheckId(): number | null` (заведена в задаче 4)
  - `POST /api/monitoring/funnels/[id]/run` → 202 `{ started: true }` / 409 / 404

- [ ] **Step 1: Написать падающий тест гонки в `persist`**

Дописать в `app/tests/monitor-run.test.ts`:

```ts
describe('запись результата', () => {
  it('чтение прошлого статуса идёт внутри транзакции', () => {
    // Транзакция better-sqlite3 синхронна: если SELECT внутри неё, весь
    // persist виден снаружи как одна операция. Проверяем структурно —
    // на исходнике, потому что гонку двух писателей тестом не поймать.
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/monitor-run.ts'), 'utf8',
    );
    const body = src.slice(src.indexOf('function persist('), src.indexOf('export async function runMonitorCycle'));
    const txAt = body.indexOf('db.transaction(');
    const selectAt = body.indexOf('.from(monitorState)');
    expect(txAt).toBeGreaterThanOrEqual(0);
    expect(selectAt).toBeGreaterThan(txAt);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/monitor-run.test.ts -t 'чтение прошлого статуса'`
Expected: FAIL — `SELECT` сейчас стоит до `db.transaction(`.

- [ ] **Step 3: Перенести чтение внутрь транзакции**

В `app/src/lib/monitor-run.ts` переписать `persist`:

```ts
/**
 * Чтение прошлого статуса стоит ВНУТРИ транзакции: SQLite сериализует пишущие
 * транзакции, и «прочитали оба, записали оба» становится невозможным. Пока
 * писатель был один, снаружи это не стреляло; ручная проверка воронки идёт
 * параллельно общему циклу, и запрет пришлось заменить настоящей защитой.
 */
function persist(db: AnyDB, target: TargetRow, result: CheckResult): void {
  db.transaction((tx) => {
    const prev = tx
      .select({
        status: monitorState.status,
        consecutiveFailures: monitorState.consecutiveFailures,
      })
      .from(monitorState)
      .where(eq(monitorState.targetId, target.id))
      .get() as { status: string; consecutiveFailures: number } | undefined;

    const prevStatus = prev?.status ?? 'unknown';
    const failures = result.status === 'down' ? (prev?.consecutiveFailures ?? 0) + 1 : 0;
    const changed = prevStatus !== result.status;

    // …дальше прежнее тело транзакции, без изменений
  });
}
```

- [ ] **Step 4: Прогнать тесты цикла**

Run: `npx vitest run tests/monitor-run.test.ts`
Expected: PASS.

- [ ] **Step 5: Написать падающий тест ручной проверки**

Дописать в `app/tests/monitor-run.test.ts`:

```ts
describe('ручная проверка воронки', () => {
  it('проверяет только адреса этой воронки, включая выключенные', async () => {
    const mine = addTarget('https://lp.example.ru/mine', 0);   // выключенная цель воронки
    const alien = addTarget('https://lp.example.ru/alien', 1); // чужая, включённая
    linkTarget(mine, funnelId);

    const asked: string[] = [];
    const check = async (url: string) => {
      asked.push(url);
      return { status: 'up' as const, httpStatus: 200, finalUrl: url, latencyMs: 1, error: '' };
    };

    await runFunnelCheck(db, funnelId, { check, sync: false, notify: async () => undefined });

    expect(asked).toEqual(['https://lp.example.ru/mine']);
    expect(asked).not.toContain('https://lp.example.ru/alien');
    expect(alien).toBeGreaterThan(0);
  });

  it('вторая проверка воронки подряд отказывается, пока идёт первая', async () => {
    const t = addTarget('https://lp.example.ru/slow', 1);
    linkTarget(t, funnelId);

    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const check = async (url: string) => {
      await gate;
      return { status: 'up' as const, httpStatus: 200, finalUrl: url, latencyMs: 1, error: '' };
    };

    const first = runFunnelCheck(db, funnelId, { check, sync: false, notify: async () => undefined });
    const second = await runFunnelCheck(db, funnelId, { check, sync: false, notify: async () => undefined });
    expect(second).toBeNull();
    release();
    expect(await first).not.toBeNull();
  });

  it('общий цикл ручной проверке не мешает', async () => {
    const t = addTarget('https://lp.example.ru/both', 1);
    linkTarget(t, funnelId);
    const check = async (url: string) => ({
      status: 'up' as const, httpStatus: 200, finalUrl: url, latencyMs: 1, error: '',
    });

    // Флаг общего цикла поднят — ручная проверка всё равно проходит.
    const cycle = runMonitorCycle(db, { check, sync: false, notify: async () => undefined });
    const manual = await runFunnelCheck(db, funnelId, { check, sync: false, notify: async () => undefined });
    expect(manual).not.toBeNull();
    await cycle;
  });
});
```

Хелперы `addTarget` / `linkTarget` / `funnelId` — по образцу уже имеющихся в этом файле; если их нет, завести так же, как в `tests/monitor-funnel-health.test.ts`.

- [ ] **Step 6: Убедиться, что тест падает**

Run: `npx vitest run tests/monitor-run.test.ts -t 'ручная проверка воронки'`
Expected: FAIL — `runFunnelCheck` не экспортируется.

- [ ] **Step 7: Написать синк одной воронки**

В `app/src/lib/monitor-targets.ts` добавить:

```ts
/**
 * Пересобирает цели и связи ОДНОЙ воронки. Нужна ручной проверке: сценарий
 * «поправил адрес → нажал проверить» иначе проверял бы старый адрес и отвечал
 * бы неверно на прямо заданный вопрос.
 *
 * Правила те же, что у общего синка, поэтому он переиспользуется целиком: цели
 * этой воронки — подмножество общего сбора, и считать их иначе значило бы
 * завести второе правило для того же.
 */
export function syncFunnelTargets(db: AnyDB, funnelId: number): void {
  syncMonitorTargets(db);
  void funnelId;
}
```

Замечание для исполнителя: полный синк на 1767 адресов занимает доли секунды на SQLite, поэтому сужать его незачем — а второе правило сбора рано или поздно разъехалось бы с первым. Параметр остаётся в сигнатуре: он говорит, ради чего вызов, и оставляет место сужению, если синк когда-нибудь подорожает.

- [ ] **Step 8: Написать ручную проверку**

В `app/src/lib/monitor-run.ts`:

```ts
import { monitorTargetFunnels } from '../db/schema';
import { syncFunnelTargets, syncMonitorTargets } from './monitor-targets';

/**
 * Прогон по целям одной воронки. Возвращает null, если ручная проверка уже идёт.
 *
 * Флаг свой, отдельный от общего цикла: общий идёт около трёх минут из каждых
 * пятнадцати, и единый флаг давал бы отказ на каждом пятом клике по главной
 * кнопке. Гонку за одну цель закрывает транзакция в persist, а не запрет.
 *
 * Проверяются ВСЕ адреса воронки, включая выключенные: у черновика все цели
 * выключены по построению, и «только включённое» проверило бы ноль адресов и
 * отчиталось бы об успехе.
 *
 * Telegram отсюда молчит: человек смотрит на экран, а сообщение на каждый клик
 * превратило бы сводку о падениях в шум.
 */
export async function runFunnelCheck(
  db: AnyDB,
  funnelId: number,
  opts: CycleOptions = {},
): Promise<CycleResult | null> {
  const state = runState();
  if (state.funnelCheckId != null) return null;
  state.funnelCheckId = funnelId;

  const check: CheckFn = opts.check ?? ((url) => checkUrl(url));
  const concurrency = opts.concurrency ?? CONCURRENCY;
  const retryDelayMs = opts.retryDelayMs ?? RETRY_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const startedAt = new Date().toISOString();
  const tally = { up: 0, slow: 0, down: 0 };

  try {
    if (opts.sync !== false) syncFunnelTargets(db, funnelId);

    const targets = db
      .select({ id: monitorTargets.id, url: monitorTargets.url })
      .from(monitorTargets)
      .innerJoin(monitorTargetFunnels, eq(monitorTargetFunnels.targetId, monitorTargets.id))
      .where(eq(monitorTargetFunnels.funnelId, funnelId))
      .all() as TargetRow[];

    let cursor = 0;
    let checked = 0;
    const worker = async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= targets.length) return;
        const target = targets[index];
        try {
          const result = await checkWithRetry(target.url, check, retryDelayMs, sleep);
          persist(db, target, result);
          tally[result.status] += 1;
          checked += 1;
        } catch (err) {
          console.error(`monitor: цель ${target.url} упала с ошибкой`, err);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, Math.max(targets.length, 1)) }, worker),
    );

    return {
      checked,
      up: tally.up,
      slow: tally.slow,
      down: tally.down,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } finally {
    state.funnelCheckId = null;
  }
}
```

- [ ] **Step 9: Прогнать тесты цикла**

Run: `npx vitest run tests/monitor-run.test.ts`
Expected: PASS.

- [ ] **Step 10: Написать роут запуска**

Создать `app/src/app/api/monitoring/funnels/[id]/run/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { runFunnelCheck, runningFunnelCheckId } from '@/lib/monitor-run';
import { funnelExists } from '@/lib/funnel-days';
import { parseRouteId } from '@/lib/validation';
import { requireEditor } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Отвечает 202, не дожидаясь конца: у воронки в среднем 24 адреса, максимум 49,
 * и при полностью мёртвом наборе (10 с таймаут + 3 с пауза + 10 с ретрай на
 * цель) проверка занимает минуты. Страница узнаёт об окончании опросом
 * GET /api/monitoring/funnels/[id] по полю `checking`.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const denied = await requireEditor(req);
  if (denied) return denied;

  const { id } = await params;
  const numId = parseRouteId(id);
  if (numId === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!funnelExists(db, numId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (runningFunnelCheckId() !== null) {
    return NextResponse.json({ error: 'Проверка воронки уже идёт' }, { status: 409 });
  }

  // runFunnelCheck поднимает флаг синхронно, до первого await.
  void runFunnelCheck(db, numId).catch((err: unknown) => {
    // Промис никто не ждёт: без catch отказ стал бы unhandled rejection,
    // а это валит процесс Node целиком.
    console.error('POST /api/monitoring/funnels/[id]/run: проверка упала', err);
  });

  return NextResponse.json({ started: true }, { status: 202 });
}
```

- [ ] **Step 11: Дописать тесты роута запуска**

В `app/tests/api-monitoring-funnels-route.test.ts`:

```ts
describe('POST /api/monitoring/funnels/[id]/run', () => {
  it('анониму — 401', async () => {
    const res = await RUN(makeRequest('http://localhost/api/monitoring/funnels/1/run', 'POST'), {
      params: Promise.resolve({ id: '1' }),
    });
    expect(res.status).toBe(401);
  });

  it('несуществующая воронка — 404', async () => {
    const res = await RUN(editorRequest('http://localhost/api/monitoring/funnels/999999/run', 'POST'), {
      params: Promise.resolve({ id: '999999' }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 12: Прогнать всё**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: зелено.

- [ ] **Step 13: Коммит**

```bash
git add app/src/lib/monitor-run.ts app/src/lib/monitor-targets.ts \
        app/src/app/api/monitoring/funnels app/tests/monitor-run.test.ts \
        app/tests/api-monitoring-funnels-route.test.ts
git commit -m "$(cat <<'EOF'
feat(мониторинг): ручная проверка одной воронки

Свой флаг, отдельный от общего цикла: общий идёт около трёх минут из
каждых пятнадцати, и единый флаг давал бы отказ на каждом пятом клике.
Гонку за одну цель теперь закрывает не запрет, а транзакция: чтение
прошлого статуса в persist переехало внутрь неё.

Проверяются все адреса воронки, включая выключенные, — иначе у черновика
проверялся бы ноль адресов, и это выглядело бы как успех. Перед прогоном
цели пересобираются, чтобы «поправил адрес → проверь» не отвечало про
старый адрес.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Пилюля, чип фильтра, пункт меню, секция карточки

**Files:**
- Create: `app/src/components/FunnelHealthPill.tsx`
- Create: `app/src/components/FunnelHealthSection.tsx`
- Modify: `app/src/components/FunnelCard.tsx`
- Modify: `app/src/app/page.tsx`
- Modify: `app/src/components/FunnelSections.tsx`
- Test: `app/tests/monitor-funnel-health.test.ts` (дописать кейс подписи)

**Interfaces:**
- Consumes: `FunnelHealth`, `funnelHealthTone` из `monitor-funnel-health.ts`; `funnelHref` из `front-code.ts`; `useCanEdit`.
- Produces:
  - `funnelHealthPillLabel(h: FunnelHealth): string` в `monitor-funnel-health.ts`
  - `FunnelCardProps` получает `health?: FunnelHealth | null` и `onCheck: () => void`
  - якорь секции — `id="health"`, ссылка `${funnelHref(f)}#health`

- [ ] **Step 1: Написать падающий тест подписи пилюли**

Дописать в `app/tests/monitor-funnel-health.test.ts`:

```ts
describe('подпись пилюли', () => {
  const h = (down: number, unknown: number) =>
    ({ down, unknown, enabled: 5, total: 7, lastCheckedAt: null });

  it('падения считает числом', () => {
    expect(funnelHealthPillLabel(h(3, 0))).toBe('Проверить · 3');
  });

  it('одно падение — тоже с числом, чтобы подпись не прыгала', () => {
    expect(funnelHealthPillLabel(h(1, 0))).toBe('Проверить · 1');
  });

  it('без падений, но без проверок — «Не проверялось»', () => {
    expect(funnelHealthPillLabel(h(0, 2))).toBe('Не проверялось');
  });

  it('всё живо — пустая подпись', () => {
    expect(funnelHealthPillLabel(h(0, 0))).toBe('');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает, и добавить функцию**

Run: `npx vitest run tests/monitor-funnel-health.test.ts -t 'подпись пилюли'`
Expected: FAIL.

Добавить в `app/src/lib/monitor-funnel-health.ts`:

```ts
/** Подпись пилюли. Пустая строка — пилюли нет. */
export function funnelHealthPillLabel(h: FunnelHealth): string {
  const tone = funnelHealthTone(h);
  if (tone === 'down') return `Проверить · ${h.down}`;
  if (tone === 'unknown') return 'Не проверялось';
  return '';
}
```

Run: `npx vitest run tests/monitor-funnel-health.test.ts`
Expected: PASS.

- [ ] **Step 3: Написать пилюлю**

Создать `app/src/components/FunnelHealthPill.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { AlertCircle, HelpCircle } from 'lucide-react';
import {
  funnelHealthTone,
  funnelHealthPillLabel,
  type FunnelHealth,
} from '@/lib/monitor-funnel-health';

interface Props {
  health: FunnelHealth;
  href: string;
}

/**
 * Пилюля состояния ссылок. Живёт внутри той же flex-группы, что StatusPill и
 * чип типа воронки: отдельная колонка сетки оставила бы дыру у большинства
 * строк — пилюля есть у меньшинства.
 */
export default function FunnelHealthPill({ health, href }: Props) {
  const tone = funnelHealthTone(health);
  if (tone === 'ok') return null;

  const isDown = tone === 'down';
  const Icon = isDown ? AlertCircle : HelpCircle;

  return (
    <Link
      href={href}
      title={
        isDown
          ? `${health.down} из ${health.total} адресов не отвечают`
          : 'Адреса этой воронки ещё ни разу не проверяли'
      }
      className={[
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition',
        isDown
          ? 'bg-[#FBE3E3] text-[#A32020] hover:bg-[#F7D2D2]'
          : 'bg-[#E8E4DA] text-[#5E5A52] hover:bg-[#DFDACE]',
      ].join(' ')}
    >
      <Icon className="h-3 w-3" />
      {funnelHealthPillLabel(health)}
    </Link>
  );
}
```

- [ ] **Step 4: Вставить пилюлю и пункт меню в карточку списка**

В `app/src/components/FunnelCard.tsx`:

- расширить пропсы:

```tsx
interface FunnelCardProps {
  funnel: Funnel;
  /** Состояние ссылок; null — не загружено или аноним. */
  health?: FunnelHealth | null;
  onSetStatus: (status: FunnelStatus) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCheck: () => void;
}
```

- первой строкой внутри `<div className="flex min-w-0 flex-wrap items-center gap-1">` (там, где `StatusPill`):

```tsx
        {health && <FunnelHealthPill health={health} href={`${href}#health`} />}
```

- в меню статусов, после списка `FUNNEL_STATUSES`, добавить разделитель и пункт:

```tsx
                <div className="my-1 h-px bg-[var(--color-border-soft)]" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onCheck();
                  }}
                  className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-[#111111] transition hover:bg-[#F5F3EE]"
                >
                  Проверить ссылки
                </button>
```

- [ ] **Step 5: Загрузить состояние и завести чип в списке**

В `app/src/app/page.tsx`:

```tsx
const [health, setHealth] = useState<Record<number, FunnelHealth>>({});
const [problemsOnly, setProblemsOnly] = useState(false);

// Состояние мониторинга приходит вторым запросом и только редактору: роут
// закрыт requireEditor, анониму он ответит 401. Отказ гасим молча — список
// воронок обязан работать и без мониторинга.
useEffect(() => {
  if (!canEdit) return;
  let cancelled = false;
  fetch('/api/monitoring/funnels')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (cancelled || !data?.health) return;
      setHealth(data.health);
    })
    .catch(() => {});
  return () => { cancelled = true; };
}, [canEdit, reloadKey]);
```

В `searchedFunnels` добавить условие чипа:

```tsx
  const searchedFunnels = useMemo(() => {
    return funnels
      .filter((f) => isFunnelVisible(f, statusFilter, search))
      .filter((f) => !problemsOnly || funnelHealthTone(health[f.id] ?? EMPTY_HEALTH) !== 'ok')
      .sort(compareByFrontCodeDesc);
  }, [funnels, statusFilter, search, problemsOnly, health]);
```

где рядом с константами файла:

```tsx
const EMPTY_HEALTH: FunnelHealth = { down: 0, unknown: 0, enabled: 0, total: 0, lastCheckedAt: null };
```

Чип — сразу после `<FacetBar …/>`, только редактору:

```tsx
      {!loading && canEdit && funnels.length > 0 && (
        <button
          type="button"
          onClick={() => setProblemsOnly((v) => !v)}
          aria-pressed={problemsOnly}
          className={[
            'mb-3 inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1 text-[12px] transition',
            problemsOnly
              ? 'border-[#F3B8AD] bg-[#FBE3E3] text-[#A32020]'
              : 'border-[var(--color-border-soft)] bg-white text-[var(--color-text-secondary)] hover:border-[var(--color-text-secondary)]',
          ].join(' ')}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          Только с проблемами
        </button>
      )}
```

Порядок списка **не трогать**: `compareByFrontCodeDesc` остаётся единственной сортировкой.

В `renderCard` пробросить состояние и обработчик:

```tsx
        health={health[funnel.id] ?? null}
        onCheck={() => handleCheck(funnel)}
```

и сам обработчик:

```tsx
  const handleCheck = useCallback(async (funnel: FunnelListItem) => {
    try {
      const res = await fetch(`/api/monitoring/funnels/${funnel.id}/run`, { method: 'POST' });
      if (res.status === 409) {
        showToast('Проверка другой воронки уже идёт', 'error');
        return;
      }
      if (!res.ok) throw new Error('Ошибка сервера');
      showToast('Проверка запущена', 'success');
    } catch {
      showToast('Не удалось запустить проверку', 'error');
    }
  }, []);
```

- [ ] **Step 6: Написать секцию карточки**

Создать `app/src/components/FunnelHealthSection.tsx` — клиентский компонент, который сам ходит за данными и опрашивает во время проверки:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useCanEdit } from './AuthProvider';
import { formatAgo } from '@/lib/monitor-status';
import type { FunnelHealth, FunnelProblem } from '@/lib/monitor-funnel-health';

interface Props {
  funnelId: number;
}

interface Payload {
  health: FunnelHealth;
  problems: FunnelProblem[];
  checking: boolean;
}

/** Те же числа, что на /monitoring: два разных периода опроса разъедутся. */
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_FAILURES = 5;

export default function FunnelHealthSection({ funnelId }: Props) {
  const canEdit = useCanEdit();
  const [data, setData] = useState<Payload | null>(null);
  const [polling, setPolling] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(async (): Promise<Payload | null> => {
    try {
      const res = await fetch(`/api/monitoring/funnels/${funnelId}`);
      if (!res.ok) return null;
      const payload: Payload = await res.json();
      if (!mountedRef.current) return null;
      setData(payload);
      return payload;
    } catch {
      return null;
    }
  }, [funnelId]);

  useEffect(() => {
    mountedRef.current = true;
    if (canEdit) void load();
    return () => { mountedRef.current = false; };
  }, [canEdit, load]);

  useEffect(() => {
    if (!polling) return;
    let failures = 0;
    const timer = setInterval(() => {
      void (async () => {
        const fresh = await load();
        if (!fresh) {
          failures += 1;
          if (failures >= MAX_POLL_FAILURES) setPolling(false);
          return;
        }
        failures = 0;
        if (!fresh.checking) setPolling(false);
      })();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [polling, load]);

  async function run() {
    const res = await fetch(`/api/monitoring/funnels/${funnelId}/run`, { method: 'POST' });
    if (res.ok) setPolling(true);
  }

  // Анониму секции нет вовсе, а не readOnly: роут ответит ему 401, и пустая
  // секция выглядела бы поломкой.
  if (!canEdit || !data) return null;

  const { health, problems, checking } = data;
  const outOfScope = health.total - health.enabled;

  return (
    <section id="health" className="mt-4 scroll-mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-[14px] font-semibold">Проверка ссылок</h2>
        <span className="text-[11px] text-[var(--color-text-secondary)]">
          Проверено: {formatAgo(health.lastCheckedAt)}
        </span>
        <button
          type="button"
          onClick={() => void run()}
          disabled={checking || polling}
          className="ml-auto inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--color-border-soft)] bg-white px-3 py-1.5 text-[12px] transition hover:border-[#111111] disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checking || polling ? 'animate-spin' : ''}`} />
          {checking || polling ? 'Проверяем…' : 'Проверить сейчас'}
        </button>
      </div>

      {problems.length === 0 ? (
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          Все проверенные адреса отвечают.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {problems.map((p) => (
            <li
              key={p.url}
              className="rounded-[8px] border border-[var(--color-border-soft)] bg-white px-3 py-2"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[12px] font-semibold text-[#A32020]">
                  {p.error || 'Не проверялось'}
                </span>
                <span className="text-[11px] text-[var(--color-text-secondary)]">{p.origin}</span>
                {!p.enabled && (
                  <span className="rounded bg-[#E8E4DA] px-1.5 py-0.5 text-[10px] text-[#5E5A52]">
                    вне постоянной проверки
                  </span>
                )}
              </div>
              <div className="mt-0.5 break-all text-[11px] text-[var(--color-text-secondary)]">
                {p.url}
              </div>
              {p.since && (
                <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
                  В этом состоянии: {formatAgo(p.since)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {outOfScope > 0 && (
        // Без этой строки молчание секции у воронки с выключенными «Ссылками»
        // читалось бы как «всё живо».
        <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
          {outOfScope} адресов из {health.total} вне постоянной проверки —{' '}
          <a href="/monitoring" className="underline hover:no-underline">
            группы на странице мониторинга
          </a>
          .
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Вставить секцию в карточку**

В `app/src/components/FunnelSections.tsx` добавить импорт и поставить секцию **после** закрывающего `</div>` блока `cardMode === 'edit'`, то есть последней и в обоих режимах:

```tsx
      {/* Проверка ссылок — не редактор, поэтому вне переключателя режимов:
          её читают и в просмотре. Последней: сюда приходят, уже что-то
          заподозрив, а не первым делом. */}
      <FunnelHealthSection funnelId={funnelId} />
```

- [ ] **Step 8: Проверить типы, тесты и сборку**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: зелено. `npm run build` обязателен — компоненты тянут `monitor-funnel-health`, а тот схему; если в клиентский бандл утечёт что-то Node-only, упадёт именно сборка.

- [ ] **Step 9: Живая проверка на копии базы**

```bash
cd /Users/sergeielkin/dev/ksamata/Ksamata/ksamata-funnels-db
sqlite3 ksamata_funnels.db 'PRAGMA wal_checkpoint(TRUNCATE);'
rm -f /tmp/kf-health.db
sqlite3 ksamata_funnels.db "VACUUM INTO '/tmp/kf-health.db';"
cd app
FUNNELS_DB_PATH=/tmp/kf-health.db MONITOR_ENABLED=false npm run dev
```

Проверить глазами:
1. `/monitoring` — в шапке «Проверка комнат: действует»; в группах появились «Комнаты ГК», «Комнаты Web», «Повторы».
2. Нажать «Проверить сейчас», дождаться конца цикла (~3 минуты).
3. Список воронок — у **F101** красная пилюля «Проверить · N».
4. Открыть `/funnels/f101#health` — в секции строки «Веб-комната не найдена» с происхождением «Комнаты Web · 15:00 · день 1» и т.д.
5. Нажать «Проверить сейчас» в секции — кнопка крутится и сама отпускается.
6. Чип «Только с проблемами» сужает список и не меняет порядок.

Живую базу **не трогать**: всё идёт на `/tmp/kf-health.db`. После — убедиться, что репозиторная чиста:

```bash
cd /Users/sergeielkin/dev/ksamata/Ksamata/ksamata-funnels-db
sqlite3 ksamata_funnels.db "select count(*) from monitor_targets;"   # → 0
git status --porcelain
```

- [ ] **Step 10: Коммит**

```bash
git add app/src/components/FunnelHealthPill.tsx app/src/components/FunnelHealthSection.tsx \
        app/src/components/FunnelCard.tsx app/src/components/FunnelSections.tsx \
        app/src/app/page.tsx app/src/lib/monitor-funnel-health.ts \
        app/tests/monitor-funnel-health.test.ts
git commit -m "$(cat <<'EOF'
feat(список): пилюля «Проверить» и секция разбора на карточке

Пилюля встаёт в ту же flex-группу, что статус и чип типа: отдельная
колонка оставила бы дыру у большинства строк. Видна только редактору —
роут мониторинга анониму отвечает 401.

Порядок списка не меняется: сортировка по F остаётся единственной, а
проблемные воронки отбирает чип «Только с проблемами».

Секция карточки стоит последней и вне переключателя режимов: её читают и
в просмотре, и приходят в неё, уже что-то заподозрив. Строка «N адресов
вне постоянной проверки» обязательна — без неё молчание секции читалось
бы как «всё живо».

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Выкат

Порядок из спеки, и первый пункт — не формальность: включённых целей станет 1389 вместо 117, и первый же прогон обнаружит всё, что молча лежало годами.

1. Выкатить с `MONITOR_ENABLED=false`.
2. Прогнать цикл вручную кнопкой на `/monitoring`, дождаться конца.
3. Разобрать находки: настоящие поломки — чинить, законно мёртвые страницы архива — оставить (пилюля их и так гасит через неделю).
4. Включить `MONITOR_ENABLED` обратно.

Без этого первая же сводка в Telegram придёт с трёхзначным числом в заголовке, и её прочтут как аварию.

## Самопроверка плана

**Покрытие спеки.** Раздел 1 (комнаты) → задача 2; раздел 2 (признак и канарейка) → задача 1; раздел 3 (агрегат, доступ, смена смысла связей) → задачи 3 и 4; раздел 4 (ручная проверка) → задача 5; раздел 5 (интерфейс) → задача 6; «Чего не делаем» → зафиксировано в Global Constraints и в шагах (порядок списка, отсутствие троттла, `room_gc` без проверки содержимого); тесты и риски → в шагах соответствующих задач и в разделе «Выкат».

**Заглушек нет.** Единственное место, где исполнителю предложено смотреть по образцу, — тестовые хелперы `addTarget`/`linkTarget`/`editorRequest`: они уже существуют в соседних файлах тестов, и дублировать их текст в плане значило бы зафиксировать копию, которая разойдётся с оригиналом.

**Имена сходятся.** `FunnelHealth`, `funnelHealthTone`, `funnelHealthPillLabel`, `getFunnelHealth`, `listFunnelProblems`, `collectFunnelOrigins`, `STALE_AFTER_DAYS`, `runFunnelCheck`, `runningFunnelCheckId`, `syncFunnelTargets`, `DEFAULT_ENABLED_SOURCE_KINDS`, `ROOM_SOURCE_KINDS`, `SOFT_MISSING`, `softMissingReason`, `hasSoftMissingRule`, `SOFT_MISSING_MAX_BYTES`, `CANARY_URL`, `canaryVerdict`, `getCanaryState`, `resetCanaryCache`, `CANARY_TTL_MS`, `roomCheckLabel`, `parseSqliteUtc` — каждое заведено ровно в одной задаче и употребляется дальше в том же написании.
