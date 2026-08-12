/**
 * One-off (2026-08-12): проставить воронкам ссылки на дашборды и выборки ГК
 * из двух таблиц владельца — «ЖИВО — ДБ_СТАТА ПОДРЯДЧИКИ» и «Ссылки для сбора
 * статы — Рабочие».
 *
 * Что и куда пишется:
 *
 *   - живое представление ссылок — блок `links` («Ссылки / дашборды»): именно
 *     его показывает и правит админка. Колонки `dash_*`/`regi_*` в `app/src`
 *     не читает никто, кроме `schema.ts`, — их наследие видит только
 *     `tools/data-export/ksamata_funnels_export.py`. Поэтому пишем в блок, а
 *     колонки обновляем следом тем же значением, чтобы XLSX-экспорт не
 *     расходился с админкой;
 *   - `funnel/update?id=` в колонке «Дашборд продаж» — это дашборд (решение
 *     владельца 12.08); так уже лежит у f31 с прошлого импорта;
 *   - «ЗАЯВКИ»/«ОПЛАТЫ» из ЖИВО-таблицы кладём отдельными элементами блока —
 *     колонки под них в схеме нет и заводить её не за чем.
 *
 * Откуда что взято — по одной причине на каждый неочевидный выбор:
 *
 *   - заявки/оплаты ЖИВО берутся ТОЛЬКО из «ЖИВО — ДБ_СТАТА». Нижний
 *     ЖИВО-блок второй таблицы (строки 25–28, 63–65, 72–75) дублирует её и
 *     местами с чужим F-кодом: строка 27 подписана «F46», но её лендинг
 *     `t.sustavy-legko.ru/trial/nimb/a` принадлежит f47, а строка 64 («F46»)
 *     несёт сегмент 36228641 — он от ГК-лендинга. Привязка ЖИВО-таблицы
 *     проверена по лендингам: все 12 строк с F-кодом совпали с базой точно;
 *   - строка ЖИВО-таблицы без кода («ИНХАУС ЯНДЕКС ГК»,
 *     `gc.zdravo-telo.ru/jivo/sust/inhouse/a`) — это второй лендинг f56,
 *     поэтому её выборки идут в f56 отдельной парой «— ГК-лендинг»;
 *   - f15 пропущен намеренно: во второй таблице в колонке «Общ реги ГК» лежит
 *     ссылка на дашборд `1615272`, а не выборка. Права база — это ошибка
 *     таблицы;
 *   - f28 — единственная перезапись непустых значений. Её три ссылки на
 *     регистрации в базе указывали на оффер 8074260 без тегов (а у
 *     «Регистраций всего» ещё и даты 20.05.2022–24.05.2022), в таблице —
 *     8438156 с фильтром «АВ Подрядчик: ИНХАУЗ». Дашборд продаж у f28 в базе
 *     совпадал с дашбордом f16 (`1665622`) — таблица даёт свой,
 *     `funnel/update?id=1686288`.
 *
 * Остальные значения ставятся только там, где в базе пусто: непустое
 * расхождение — повод спросить владельца, а не переписать молча.
 *
 * Идемпотентно: повторный запуск не меняет ничего (сверка по нормализованному
 * URL — регистр, хвостовой слэш и `#pk=` не считаются различием).
 *
 * Запуск из `app/`:  npx tsx scripts/fill-dashboards-2026-08-12.ts [--apply]
 * Без `--apply` — сухой прогон.
 */

import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getBlock, replaceBlock, type BlockItem } from '../src/lib/funnel-blocks';

type Field =
  | 'dashSalesUrl' | 'dashPerelivUrl' | 'regiTotalUrl'
  | 'regi15Url' | 'regi19Url' | 'regiNotimeUrl';

type PlanEntry = {
  frontCode: string;
  id: number;
  update: Record<Field, string>;
  linkItems: { label: string; url: string }[];
};

/**
 * Имя поля плана -> имя свойства в Drizzle. Отличается ровно одно: колонка
 * `dash_pereliv_url` объявлена как `dashPedelivUrl` — опечатка в `schema.ts`.
 * Без этой таблицы `set({ dashPerelivUrl })` молча проходит мимо: Drizzle
 * игнорирует неизвестный ключ, а `row[field]` отдаёт undefined, так что
 * скрипт каждый раз считает колонку пустой и «пишет» её вхолостую.
 */
const PROP: Record<Field, keyof typeof funnels.$inferSelect> = {
  dashSalesUrl:   'dashSalesUrl',
  dashPerelivUrl: 'dashPedelivUrl',
  regiTotalUrl:   'regiTotalUrl',
  regi15Url:      'regi15Url',
  regi19Url:      'regi19Url',
  regiNotimeUrl:  'regiNotimeUrl',
};

/** Одинаковая ссылка с точностью до регистра, хвостового слэша и якоря. */
function sameUrl(a: string, b: string): boolean {
  const n = (u: string) => decodeURIComponent(u.trim()).split('#')[0].replace(/\/+$/, '').toLowerCase();
  return a.trim() !== '' && n(a) === n(b);
}

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const planPath = process.argv.find((a) => a.endsWith('.json'))
  ?? new URL('./fill-dashboards-2026-08-12.plan.json', import.meta.url).pathname;
const plan: PlanEntry[] = JSON.parse(readFileSync(planPath, 'utf8'));
const apply = process.argv.includes('--apply');

let touchedFunnels = 0, addedItems = 0, replacedItems = 0, columnsWritten = 0;

for (const entry of plan) {
  const row = db.select().from(funnels).where(eq(funnels.id, entry.id)).get();
  if (!row) {
    console.log(`${entry.frontCode.toUpperCase()}: воронки нет, пропуск`);
    continue;
  }

  const block = getBlock(db, entry.id, 'links');
  const items: BlockItem[] = block.items.map((i) => ({ ...i }));
  const log: string[] = [];

  for (const { label, url } of entry.linkItems) {
    const at = items.findIndex((i) => sameLabel(i.label, label));
    if (at === -1) {
      items.push({ slot: null, label, url });
      addedItems++;
      log.push(`  + «${label}»`);
    } else if (sameUrl(items[at].url, url)) {
      // уже стоит — идемпотентность
    } else if (items[at].url.trim() === '' || entry.frontCode === 'f28') {
      log.push(`  ~ «${label}» ${items[at].url.trim() === '' ? 'заполнено' : 'перезаписано'}`);
      items[at] = { ...items[at], url };
      replacedItems++;
    } else {
      log.push(`  ! «${label}» — в блоке уже другой адрес, не трогаю`);
    }
  }

  const columnUpdate: Partial<typeof funnels.$inferInsert> = {};
  for (const [field, url] of Object.entries(entry.update) as [Field, string][]) {
    const prop = PROP[field];
    const current = (row[prop] as string | null) ?? '';
    if (sameUrl(current, url)) continue;
    if (current.trim() !== '' && entry.frontCode !== 'f28') {
      log.push(`  ! колонка ${prop} непуста и отличается, не трогаю`);
      continue;
    }
    (columnUpdate as Record<string, string>)[prop] = url;
    columnsWritten++;
  }

  const blockChanged = items.length !== block.items.length
    || items.some((it, i) => it.url !== block.items[i].url || it.label !== block.items[i].label);

  if (!blockChanged && Object.keys(columnUpdate).length === 0) continue;
  touchedFunnels++;
  console.log(`${entry.frontCode.toUpperCase()} (id=${entry.id})`);
  log.forEach((l) => console.log(l));
  if (Object.keys(columnUpdate).length) console.log(`  колонки: ${Object.keys(columnUpdate).join(', ')}`);

  if (!apply) continue;
  db.transaction((tx) => {
    if (blockChanged) replaceBlock(tx, entry.id, 'links', true, block.mode, items);
    if (Object.keys(columnUpdate).length) {
      tx.update(funnels).set(columnUpdate).where(eq(funnels.id, entry.id)).run();
    }
  });
}

console.log(
  `\n${apply ? 'ЗАПИСАНО' : 'СУХОЙ ПРОГОН'}: воронок ${touchedFunnels}, ` +
  `элементов блока добавлено ${addedItems}, заполнено/перезаписано ${replacedItems}, ` +
  `колонок ${columnsWritten}`,
);
if (!apply) console.log('Запустить с --apply, чтобы записать.');
