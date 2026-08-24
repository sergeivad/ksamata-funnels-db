/**
 * One-off (2026-08-24): перенос воронки `f95` из ПРОДА в **репозиторную базу**.
 *
 * Целевая база — `ksamata_funnels.db` в корне репозитория (не прод!). На проде
 * воронка уже есть и создана там 2026-08-13; здесь её просто не было, и стороны
 * разошлись: 76 воронок на проде против 75 локально.
 *
 * Источник данных — прямое чтение прода 2026-08-24:
 *   ssh server_ksamata_prod → docker exec <funnels-admin> → /data/ksamata_funnels.db
 * Скопированы дословно: оси, тип, `num`, статус, метки времени, признаки комнат,
 * десять дней с повторами дней 4-5 и семь блоков с их пунктами.
 *
 * `num = 80` взят с прода намеренно, хотя локально свободен и 79: пока номера
 * совпадают, стороны можно сверять по `num` в лоб. На проде 79 пропущен.
 *
 * Теги не выставляются руками — их материализует `createFunnel` из шаблона и
 * осей. Шаблоны локально и на проде совпадают (проверено: `автоворонки`,
 * `АВ Этап: Оплата`, `АВ Время: 15/19`), поэтому набор выйдет тот же.
 *
 * Правила:
 *   - Только через доменную логику (`createFunnel` / `replaceDays` /
 *     `replaceBlock`), без сырого SQL: теги и справочники создаются попутно.
 *   - Каждый URL блока прогоняется через `checkUrlField` — `replaceBlock`
 *     сам не проверяет, а админка потом откажется сохранять то, что приняла
 *     бы за мусор на вводе (см. CLAUDE.md и block-url-hygiene.test.ts).
 *   - Идемпотентно: если `f95` уже есть, скрипт ничего не делает.
 *
 * Запуск из `app/`:  npx tsx scripts/add-f95-2026-08-24.ts
 */

import { db } from '../src/db/client';
import { createFunnel, getFunnelByFrontCode } from '../src/lib/funnels';
import { replaceDays, type DayCell } from '../src/lib/funnel-days';
import { replaceBlock, type BlockItem } from '../src/lib/funnel-blocks';
import { checkUrlField } from '../src/lib/url-field';
import type { BlockKind, BlockMode } from '../src/lib/blocks';

const FRONT_CODE = 'f95';

const gc = (slug: string) => `https://gc.ksamata.ru/${slug}`;
const web = (slug: string) => `https://web.ksamatacenter.com/room/${slug}`;

const DAYS: DayCell[] = [
  { timeSlot: '19', dayNum: 1, gcRoom: gc('boo1-vkinvk'), webRoom: web('boo1-vkinvk'), replayUrl: '' },
  { timeSlot: '19', dayNum: 2, gcRoom: gc('boo2-vkinvk'), webRoom: web('boo2-vkinvk'), replayUrl: '' },
  { timeSlot: '19', dayNum: 3, gcRoom: gc('boo3-vkinvk'), webRoom: web('boo3-vkinvk'), replayUrl: '' },
  { timeSlot: '19', dayNum: 4, gcRoom: gc('boo4-vkinvk'), webRoom: web('boo4-vkinvk'), replayUrl: gc('boo4r-vkinvk') },
  { timeSlot: '19', dayNum: 5, gcRoom: gc('boo5-vkinvk'), webRoom: web('boo5-vkinvk'), replayUrl: gc('boo5r-vkinvk') },
  { timeSlot: '15', dayNum: 1, gcRoom: gc('1boo-vkinvk'), webRoom: web('1boo-vkinvk'), replayUrl: '' },
  { timeSlot: '15', dayNum: 2, gcRoom: gc('2boo-vkinvk'), webRoom: web('2boo-vkinvk'), replayUrl: '' },
  { timeSlot: '15', dayNum: 3, gcRoom: gc('3boo-vkinvk'), webRoom: web('3boo-vkinvk'), replayUrl: '' },
  { timeSlot: '15', dayNum: 4, gcRoom: gc('4boo-vkinvk'), webRoom: web('4boo-vkinvk'), replayUrl: gc('4rboo-vkinvk') },
  { timeSlot: '15', dayNum: 5, gcRoom: gc('5boo-vkinvk'), webRoom: web('5boo-vkinvk'), replayUrl: gc('5rboo-vkinvk') },
];

type BlockSpec = { kind: BlockKind; enabled: boolean; mode: BlockMode; items: BlockItem[] };

const BLOCKS: BlockSpec[] = [
  {
    kind: 'tariffs', enabled: true, mode: 'by_time',
    items: [
      { slot: '15', label: '', url: 'https://t.ksamata.ru/dtx/tarif-1vkinvk' },
      { slot: '15', label: '', url: 'https://t.ksamata.ru/dtx/tarif-2vkinvk' },
      { slot: '15', label: '', url: 'https://t.ksamata.ru/dtx/tarif-2vkinvkz' },
      { slot: '19', label: '', url: 'https://t.ksamata.ru/dtx/tarif-vkinvk1' },
      { slot: '19', label: '', url: 'https://t.ksamata.ru/dtx/tarif-vkinvk2' },
      { slot: '19', label: '', url: 'https://t.ksamata.ru/dtx/tarif-vkinvkz2' },
    ],
  },
  {
    kind: 'applications', enabled: true, mode: 'by_time',
    items: [
      { slot: '15', label: '', url: 'https://gc.ksamata.ru/dtx/tarif/max-int-15-vkinvk' },
      { slot: '15', label: '', url: 'https://gc.ksamata.ru/dtx/tarif/curator-15-vkinvk' },
      { slot: '15', label: '', url: 'https://gc.ksamata.ru/dtx/tarif/max-n-transform-15-vkinvk' },
      { slot: '15', label: '', url: 'https://gc.ksamata.ru/dtx/tarif/max-15-vkinvk' },
      { slot: '15', label: '', url: 'https://gc.ksamata.ru/dtx/tarif/transform-15-vkinvk' },
      { slot: '19', label: '', url: 'https://gc.ksamata.ru/dtx/tarif/max-int-19-vkinvk' },
      { slot: '19', label: '', url: 'https://gc.ksamata.ru/dtx/tarif/curator-19-vkinvk' },
      { slot: '19', label: '', url: 'https://gc.ksamata.ru/dtx/tarif/max-n-transform-19-vkinvk' },
      { slot: '19', label: '', url: 'https://gc.ksamata.ru/dtx/tarif/max-19-vkinvk' },
      { slot: '19', label: '', url: 'https://gc.ksamata.ru/dtx/tarif/transform-19-vkinvk' },
    ],
  },
  { kind: 'upsell', enabled: false, mode: 'common', items: [] },
  {
    kind: 'oto', enabled: true, mode: 'by_time',
    items: [
      { slot: '15', label: '', url: 'https://gc.ksamata.ru/dtx/qh_imm15_vkinvk' },
      { slot: '19', label: '', url: 'https://gc.ksamata.ru/dtx/qh_imm19_vkinvk' },
    ],
  },
  {
    kind: 'processes', enabled: true, mode: 'common',
    items: [
      {
        slot: null, label: 'сейлбот',
        url: 'https://salebot.pro/projects/98250/messages?sheet_id=432471&id_val=59927321',
      },
    ],
  },
  {
    kind: 'links', enabled: true, mode: 'common',
    items: [
      {
        slot: null, label: 'Дашборд продаж',
        url: 'https://gc.ksamata.ru/pl/logic/funnel/dashboard?id=1696044#pk=0',
      },
    ],
  },
  {
    kind: 'landings', enabled: true, mode: 'common',
    items: [{ slot: null, label: '', url: 'https://send.ksamata.ru/ht-boo-a_0_f' }],
  },
];

function main(): void {
  const existing = getFunnelByFrontCode(db, FRONT_CODE);
  if (existing) {
    console.log(`${FRONT_CODE} уже есть в базе (#${existing.id}) — нечего делать.`);
    return;
  }

  // Гигиена ссылок до записи: replaceBlock не валидирует, а PUT-роут админки
  // валидирует, и расхождение всплывёт при первом сохранении карточки.
  const dirty: string[] = [];
  for (const block of BLOCKS) {
    for (const item of block.items) {
      const check = checkUrlField(item.url);
      if (check.level === 'error') dirty.push(`${block.kind}: ${item.url} — ${check.message}`);
    }
  }
  if (dirty.length > 0) {
    console.error('Отказ: ссылки не пройдут проверку админки:\n  ' + dirty.join('\n  '));
    process.exitCode = 1;
    return;
  }

  const created = createFunnel(db, {
    num: 80,
    frontCode: FRONT_CODE,
    status: 'active',
    productName: '',
    variant: '',
    startDate: '',
    product: 'БОО-ВК',
    contractor: 'ИНХАУЗ',
    channel: 'ВК',
    direction: 'Реклама',
    funnelType: 'АВ Автоворонка',
    sourceName: 'ВК ИНХАУЗ',
    timeLabelA: '15:00',
    timeLabelB: '19:00',
    roomsEnabled: true,
    roomsReplayEnabled: true,
  });

  replaceDays(db, created.id, DAYS);
  for (const block of BLOCKS) {
    replaceBlock(db, created.id, block.kind, block.enabled, block.mode, block.items);
  }

  console.log(
    `${FRONT_CODE} создана: #${created.id}, num ${created.num}, ${created.name}, ` +
      `дней ${DAYS.length}, блоков ${BLOCKS.length}.`,
  );
}

main();
