/**
 * Одноразовая правка АВ-осей трёх воронок (карта расхождений тегов, шаг 1).
 * Журнал разбора: docs/plans/2026-07-25-tag-drift-triage.md
 *
 * Причина: АВ-четвёрка в базе не совпадала с АВ-четвёркой в GetCourse, поэтому
 * заказы этих воронок были для аудита безымянными (класс 13: «воронка active,
 * но ни одного наблюдения»). Решение — выровнять базу под написание GetCourse.
 *
 *   f41 (num 43)  Подрядчик   Партнёр            → Партнер
 *                 Канал       Партнёры           → Партнер
 *                 Направление Партнёрский трафик → Партнерский трафик
 *   #27           Направление Перелив с БОО      → С ДБО
 *   #28           Направление Перелив с ДБО      → С БОО
 *
 * Идемпотентен: повторный запуск не меняет ничего (renameRef возвращает строку
 * как есть при совпадении имени, updateFunnel пересобирает те же теги).
 *
 * Запуск из app/:
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/fix-av-axes-2026-07-25.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels, funnelTags, tags } from '../src/db/schema';
import { updateFunnel } from '../src/lib/funnels';
import { listRefs, renameRef } from '../src/lib/refs';

/** Оси воронки, как их видит приложение — из reg-тегов. */
function axesOf(num: number): Record<string, string> {
  const row = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.num, num)).get();
  if (!row) throw new Error(`воронки num=${num} нет`);
  const names = db
    .select({ name: tags.name })
    .from(funnelTags)
    .innerJoin(tags, eq(funnelTags.tagId, tags.id))
    .where(eq(funnelTags.funnelId, row.id))
    .all()
    .map((r) => r.name)
    .filter((n) => n.startsWith('АВ Продукт') || n.startsWith('АВ Подрядчик')
                || n.startsWith('АВ Канал')   || n.startsWith('АВ Направление'));
  const out: Record<string, string> = {};
  for (const n of [...new Set(names)].sort()) {
    const [axis, value] = n.split(': ');
    out[axis] = value;
  }
  return out;
}

function show(label: string) {
  console.log(`\n--- ${label} ---`);
  for (const num of [27, 28, 43]) {
    console.log(`  num=${num}`, JSON.stringify(axesOf(num), null, 0));
  }
}

/** id справочной строки по имени, или undefined. */
function refId(kind: 'sources' | 'contractors', name: string): number | undefined {
  return listRefs(db, kind).find((r) => r.name === name)?.id;
}

function idOf(num: number): number {
  const row = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.num, num)).get();
  if (!row) throw new Error(`воронки num=${num} нет`);
  return row.id;
}

show('ДО');

// 1. Переименовать справочники НА МЕСТЕ, чтобы не оставить сирот.
//    contractors мирроринтся в тег «АВ Подрядчик: …», sources — нет (обычный FK).
for (const [kind, from, to] of [
  ['sources', 'Партнёры', 'Партнеры'],
  ['contractors', 'Партнёр', 'Партнер'],
] as const) {
  const id = refId(kind, from);
  if (id === undefined) {
    console.log(`\n${kind}: «${from}» не найден — вероятно уже переименован, пропускаю`);
    continue;
  }
  const res = renameRef(db, kind, id, to);
  console.log(`\n${kind}: «${from}» → «${to}»`, res.ok ? 'ок' : `ОШИБКА ${res.error}`);
  if (!res.ok) throw new Error(`renameRef ${kind} провалился: ${res.error}`);
}

// 2. Оси Канал и Направление живут только в тегах — их меняет updateFunnel.
//    sourceName передаём явно: иначе смена канала пересоберёт источник
//    в «Партнер Партнер» (см. updateFunnel, ветка (b)).
console.log('\n--- правки воронок ---');
const edits: [number, Parameters<typeof updateFunnel>[2], string][] = [
  [43, { contractor: 'Партнер', channel: 'Партнер',
         direction: 'Партнерский трафик', sourceName: 'Партнеры' }, 'f41'],
  [27, { direction: 'С ДБО' }, '#27 БОО Перелив СПБ'],
  [28, { direction: 'С БОО' }, '#28 ДБО Перелив БОО'],
];
for (const [num, patch, label] of edits) {
  const res = updateFunnel(db, idOf(num), patch);
  if (!res) throw new Error(`updateFunnel num=${num} вернул null`);
  console.log(`  ${label}: ${res.name}`);
}

// 3. Убрать осиротевшие АВ-теги: словарь аудита читает всю таблицу tags,
//    и брошенные значения продолжали бы считаться «известными базе».
console.log('\n--- осиротевшие АВ-теги ---');
for (const name of [
  'АВ Канал: Партнёры',
  'АВ Направление: Партнёрский трафик',
  'АВ Направление: Перелив с БОО',
  'АВ Направление: Перелив с ДБО',
]) {
  const row = db.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).get();
  if (!row) { console.log(`  «${name}»: нет в tags`); continue; }
  const used = db.select({ id: funnelTags.id }).from(funnelTags)
    .where(eq(funnelTags.tagId, row.id)).all().length;
  if (used > 0) { console.log(`  «${name}»: ещё используется (${used}) — НЕ удаляю`); continue; }
  db.delete(tags).where(eq(tags.id, row.id)).run();
  console.log(`  «${name}»: удалён`);
}

show('ПОСЛЕ');
