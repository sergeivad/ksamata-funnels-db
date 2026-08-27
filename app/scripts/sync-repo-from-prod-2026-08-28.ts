/**
 * One-off (2026-08-28): выравнивание **репозиторной базы** по ПРОДУ.
 *
 * Целевая база — `ksamata_funnels.db` в корне репозитория (не прод!).
 * Источник — снимок прода, путь передаётся флагом `--from`.
 *
 * ## Зачем
 *
 * Люди правят прод через админку, а репозиторная база отстаёт: её двигают
 * только скрипты, которые кто-то не забыл прогнать локально. К 28.08 стороны
 * разошлись на 220 пунктов блоков, 26 дней и одну воронку целиком (`f96`).
 * Обратного дрейфа почти нет: 15 пунктов, которых нет на проде, и каждый из
 * них — заменённое старьё (см. заголовок коммита), поэтому направление
 * одностороннее: **прод главнее**.
 *
 * ## Как снять снимок прода
 *
 * `VACUUM INTO`, а не копирование файла: у прода живой WAL на несколько
 * мегабайт, и голая копия `.db` приедет без последних правок.
 *
 * ```sh
 * C=$(ssh server_ksamata_prod 'docker ps --format "{{.Names}}" | grep funnels-admin | head -1')
 * # внутри контейнера: new Database('/data/ksamata_funnels.db', {readonly:true})
 * #                    .exec("VACUUM INTO '/tmp/prod-snap.db'")
 * docker cp $C:/tmp/prod-snap.db /tmp/prod-snap.db   # и дальше scp к себе
 * ```
 *
 * ## Что переносится и что нет
 *
 * Переносятся воронки, дни и блоки. НЕ переносятся:
 *
 *   - `monitor_*` — на проде это живое состояние проверок (945 целей), в
 *     репозиторной базе они обязаны оставаться пустыми (см. CLAUDE.md);
 *   - `schema_migrations` — там отличается только отметка времени прогона
 *     фазы, и она у каждой базы своя по определению;
 *   - четыре осиротевших имени в `tags` (`АВ Канал: Партнёры`,
 *     `АВ Направление: Партнёрский трафик`, `АВ Направление: Перелив с БОО`,
 *     `АВ Направление: Перелив с ДБО`). На проде на них не ссылается ничто:
 *     ни `funnel_tags`, ни оверрайды, ни шаблоны. Это мусор реестра, а не
 *     данные, и `tags` вообще не правится руками — таблицей владеет движок
 *     шаблонов и оверрайдов.
 *
 * Теги воронок руками тоже не пишутся: их материализует `createFunnel` из
 * шаблона и осей. Шаблоны и оверрайды на сторонах уже совпадают дословно
 * (проверено), поэтому набор выйдет тот же.
 *
 * ## Правила
 *
 *   - Только через доменную логику (`createFunnel` / `updateFunnel` /
 *     `replaceDays` / `replaceBlock`), без сырого SQL по цели: справочники и
 *     теги заводятся попутно.
 *   - Каждый URL блока прогоняется через `checkUrlField` — `replaceBlock` сам
 *     не проверяет, а админка потом откажется сохранять то, что приняла бы за
 *     мусор на вводе (CLAUDE.md, block-url-hygiene.test.ts). Класс A
 *     (подпись затекла в ссылку) останавливает прогон целиком; класс B
 *     (в поле пометка, а не ссылка) только печатается.
 *   - Идемпотентно: второй прогон по тому же снимку не делает ничего.
 *   - По умолчанию — сухой прогон. Писать только с `--apply`.
 *
 * Запуск из `app/`:
 *   npx tsx scripts/sync-repo-from-prod-2026-08-28.ts --from /путь/prod-snap.db
 *   npx tsx scripts/sync-repo-from-prod-2026-08-28.ts --from /путь/prod-snap.db --apply
 */

import Database from 'better-sqlite3';
import { db } from '../src/db/client';
import { createFunnel, updateFunnel, listFunnels } from '../src/lib/funnels';
import { listDays, replaceDays, type DayCell } from '../src/lib/funnel-days';
import { getBlock, replaceBlock, type BlockItem } from '../src/lib/funnel-blocks';
import { funnelBlocks } from '../src/db/schema';
import { checkUrlField } from '../src/lib/url-field';
import { BLOCK_KINDS, type BlockKind, type BlockMode } from '../src/lib/blocks';
import { AXIS_PREFIXES } from '../src/lib/ab-tags';
import { FUNNEL_STATUS_VALUES, type FunnelStatus } from '../src/lib/status';

// ── Аргументы ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const fromIdx = argv.indexOf('--from');
const SNAPSHOT = fromIdx >= 0 ? argv[fromIdx + 1] : undefined;

if (!SNAPSHOT) {
  console.error(
    'Не задан снимок прода. Запуск:\n' +
      '  npx tsx scripts/sync-repo-from-prod-2026-08-28.ts --from /путь/prod-snap.db [--apply]\n' +
      'Как снять снимок — в шапке файла.',
  );
  process.exit(1);
}

// ── Чтение снимка ────────────────────────────────────────────────────────────

const src = new Database(SNAPSHOT, { readonly: true, fileMustExist: true });

type SrcFunnel = {
  id: number;
  num: number;
  front_code: string;
  status: string;
  variant: string;
  product_name: string;
  start_date: string | null;
  block_name: string | null;
  comment: string | null;
  time_label_a: string | null;
  time_label_b: string | null;
  rooms_enabled: number;
  rooms_replay_enabled: number;
  source_name: string | null;
  product: string | null;
  contractor: string | null;
  type_name: string | null;
};

const srcFunnels = src
  .prepare(
    `select f.id, f.num, f.front_code, f.status, f.variant, f.product_name,
            f.start_date, f.block_name, f.comment, f.time_label_a, f.time_label_b,
            f.rooms_enabled, f.rooms_replay_enabled,
            s.name as source_name, p.name as product, c.name as contractor,
            t.name as type_name
       from funnels f
       left join sources s on s.id = f.source_id
       left join products p on p.id = f.product_id
       left join contractors c on c.id = f.contractor_id
       left join funnel_types t on t.id = f.funnel_type_id
      order by f.num`,
  )
  .all() as SrcFunnel[];

/**
 * Канал и направление в схеме отдельными колонками не лежат — они живут
 * только в `funnel_tags` сценария `reg`. Читаем оттуда, как это делает
 * `getAxesForFunnel`, а не гадаем по имени источника: «Ютуб НИМБ» — это
 * источник, а не ось.
 */
const srcRegTags = src
  .prepare(
    `select ft.funnel_id, g.name
       from funnel_tags ft join tags g on g.id = ft.tag_id
      where ft.tag_type = 'reg'`,
  )
  .all() as { funnel_id: number; name: string }[];

const axisByFunnel = new Map<number, { channel: string; direction: string }>();
for (const row of srcRegTags) {
  const cur = axisByFunnel.get(row.funnel_id) ?? { channel: '', direction: '' };
  if (row.name.startsWith(AXIS_PREFIXES.channel)) {
    cur.channel = row.name.slice(AXIS_PREFIXES.channel.length);
  } else if (row.name.startsWith(AXIS_PREFIXES.direction)) {
    cur.direction = row.name.slice(AXIS_PREFIXES.direction.length);
  }
  axisByFunnel.set(row.funnel_id, cur);
}

const srcDays = src
  .prepare(
    `select funnel_id, time_slot, day_num, gc_room, web_room, replay_url
       from funnel_days order by funnel_id, time_slot, day_num`,
  )
  .all() as {
  funnel_id: number;
  time_slot: string;
  day_num: number;
  gc_room: string | null;
  web_room: string | null;
  replay_url: string | null;
}[];

const srcBlocks = src
  .prepare(`select id, funnel_id, kind, enabled, mode from funnel_blocks`)
  .all() as { id: number; funnel_id: number; kind: string; enabled: number; mode: string }[];

const srcItems = src
  .prepare(`select block_id, slot, label, url from funnel_block_items order by position`)
  .all() as { block_id: number; slot: string | null; label: string | null; url: string | null }[];

const itemsByBlock = new Map<number, BlockItem[]>();
for (const i of srcItems) {
  const list = itemsByBlock.get(i.block_id) ?? [];
  list.push({
    slot: (i.slot as '15' | '19' | null) ?? null,
    label: i.label ?? '',
    url: i.url ?? '',
  });
  itemsByBlock.set(i.block_id, list);
}

const KNOWN_KINDS = new Set<string>(BLOCK_KINDS.map((d) => d.kind));

// ── Гигиена ссылок: проверяем ВЕСЬ снимок до первой записи ────────────────────

const urlErrors: string[] = [];
const urlWarns: string[] = [];
const funnelBySrcId = new Map<number, SrcFunnel>(srcFunnels.map((f) => [f.id, f]));

for (const b of srcBlocks) {
  const owner = funnelBySrcId.get(b.funnel_id);
  const who = `${owner?.front_code || `#${b.funnel_id}`} / ${b.kind}`;
  for (const item of itemsByBlock.get(b.id) ?? []) {
    const check = checkUrlField(item.url);
    if (check.level === 'error') urlErrors.push(`${who}: ${check.message} (${item.url})`);
    else if (check.level === 'warn') urlWarns.push(`${who}: ${check.message} (${item.url || 'пусто'})`);
  }
}

if (urlWarns.length) {
  console.log(`\n⚠ Класс B — в поле ссылки пометка, а не адрес (${urlWarns.length}). Переносим как есть:`);
  for (const w of urlWarns) console.log(`   ${w}`);
}

if (urlErrors.length) {
  console.error(`\n✖ Класс A — подпись затекла в ссылку (${urlErrors.length}). Такое админка не сохранит:`);
  for (const e of urlErrors) console.error(`   ${e}`);
  console.error('\nПрогон остановлен: сначала почините эти пункты на проде, потом снимайте снимок заново.');
  process.exit(1);
}

// ── Планирование ─────────────────────────────────────────────────────────────

const repoFunnels = listFunnels(db);
const repoByCode = new Map(repoFunnels.map((f) => [f.frontCode, f]));

/** Физически существующие строки `funnel_blocks` цели — см. пояснение ниже. */
const repoBlockRows = new Set(
  (db.select({ funnelId: funnelBlocks.funnelId, kind: funnelBlocks.kind }).from(funnelBlocks).all() as {
    funnelId: number;
    kind: string;
  }[]).map((r) => `${r.funnelId}:${r.kind}`),
);

type Action = { what: string; run: () => void };
const plan: Action[] = [];

const sameDays = (a: DayCell[], b: DayCell[]) =>
  JSON.stringify([...a].sort((x, y) => x.timeSlot.localeCompare(y.timeSlot) || x.dayNum - y.dayNum)) ===
  JSON.stringify([...b].sort((x, y) => x.timeSlot.localeCompare(y.timeSlot) || x.dayNum - y.dayNum));

function daysOf(srcId: number): DayCell[] {
  return srcDays
    .filter((d) => d.funnel_id === srcId)
    .map((d) => ({
      timeSlot: d.time_slot as '19' | '15',
      dayNum: d.day_num,
      gcRoom: d.gc_room ?? '',
      webRoom: d.web_room ?? '',
      replayUrl: d.replay_url ?? '',
    }));
}

function blocksOf(srcId: number) {
  return srcBlocks
    .filter((b) => b.funnel_id === srcId)
    .filter((b) => KNOWN_KINDS.has(b.kind))
    .map((b) => ({
      kind: b.kind as BlockKind,
      enabled: b.enabled === 1,
      mode: b.mode as BlockMode,
      items: itemsByBlock.get(b.id) ?? [],
    }));
}

/** Колонки воронки, которые сверяем и правим. Теги сюда не входят — они производные. */
function funnelPayload(f: SrcFunnel) {
  const axes = axisByFunnel.get(f.id) ?? { channel: '', direction: '' };
  return {
    num: f.num,
    frontCode: f.front_code,
    status: f.status as FunnelStatus,
    productName: f.product_name ?? '',
    variant: f.variant ?? '',
    startDate: f.start_date ?? '',
    blockName: f.block_name ?? '',
    product: f.product ?? '',
    contractor: f.contractor ?? '',
    channel: axes.channel,
    direction: axes.direction,
    funnelType: f.type_name ?? '',
    comment: f.comment ?? '',
    timeLabelA: f.time_label_a ?? '15:00',
    timeLabelB: f.time_label_b ?? '19:00',
    roomsEnabled: f.rooms_enabled === 1,
    roomsReplayEnabled: f.rooms_replay_enabled === 1,
    sourceName: f.source_name ?? '',
  };
}

for (const f of srcFunnels) {
  if (!FUNNEL_STATUS_VALUES.includes(f.status as FunnelStatus)) {
    console.error(`✖ ${f.front_code}: неизвестный статус «${f.status}»`);
    process.exit(1);
  }
  const payload = funnelPayload(f);
  const existing = repoByCode.get(f.front_code);

  if (!existing) {
    plan.push({
      what: `создать воронку ${f.front_code} «${payload.product} / ${payload.contractor} / ${payload.channel} / ${payload.direction}» (num ${f.num}, ${f.status})`,
      run: () => {
        const created = createFunnel(db, payload);
        const dd = daysOf(f.id);
        if (dd.length) replaceDays(db, created.id, dd);
        for (const b of blocksOf(f.id)) replaceBlock(db, created.id, b.kind, b.enabled, b.mode, b.items);
        // replaceDays поднимает rooms_enabled сам и только вверх — возвращаем
        // ровно то, что стоит на проде, чтобы не развести стороны заново.
        updateFunnel(db, created.id, { roomsEnabled: payload.roomsEnabled });
      },
    });
    continue;
  }

  const id = existing.id;

  // Дни
  const wantDays = daysOf(f.id);
  const haveDays = listDays(db, id);
  if (!sameDays(haveDays, wantDays)) {
    plan.push({
      what: `${f.front_code}: дни ${haveDays.length} → ${wantDays.length}`,
      run: () => {
        replaceDays(db, id, wantDays);
        updateFunnel(db, id, { roomsEnabled: payload.roomsEnabled });
      },
    });
  }

  // Блоки
  for (const b of blocksOf(f.id)) {
    const have = getBlock(db, id, b.kind);
    // Сравниваем и наличие самой строки, а не только её содержимое: у пустого
    // блока с дефолтными enabled/mode `getBlock` отдаёт ровно то же, что и при
    // отсутствии строки, и разницу видно только в счётчике funnel_blocks
    // (на 28.08 — f34 и f78, «Допродажи / дожим»). Для приложения это
    // безразлично, но сверка сторон по числу строк спотыкается об это каждый раз.
    const rowExists = repoBlockRows.has(`${id}:${b.kind}`);
    const same =
      rowExists &&
      have.enabled === b.enabled &&
      have.mode === b.mode &&
      JSON.stringify(have.items) === JSON.stringify(b.items);
    if (same) continue;
    plan.push({
      what:
        `${f.front_code} / ${b.kind}: ` +
        (rowExists ? '' : 'строки блока не было, ') +
        `пунктов ${have.items.length} → ${b.items.length}` +
        (have.mode !== b.mode ? `, режим ${have.mode} → ${b.mode}` : '') +
        (have.enabled !== b.enabled ? `, включён ${have.enabled} → ${b.enabled}` : ''),
      run: () => replaceBlock(db, id, b.kind, b.enabled, b.mode, b.items),
    });
  }
}

// ── Отчёт и запись ───────────────────────────────────────────────────────────

console.log(`\nСнимок: ${SNAPSHOT}`);
console.log(`Воронок в снимке: ${srcFunnels.length}, в репозиторной базе: ${repoFunnels.length}`);
console.log(`\nДействий запланировано: ${plan.length}`);
for (const a of plan) console.log(`  · ${a.what}`);

if (!plan.length) {
  console.log('\nСтороны уже сошлись — делать нечего.');
  process.exit(0);
}

if (!APPLY) {
  console.log('\nСухой прогон. Чтобы записать, добавьте --apply.');
  process.exit(0);
}

for (const a of plan) a.run();
console.log(`\nЗаписано: ${plan.length} действий.`);
