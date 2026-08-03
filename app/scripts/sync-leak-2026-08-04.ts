/**
 * One-off (2026-08-04): sync a fixed set of funnels to what LeakEngine
 * currently reports (see the task write-up, not meant to be reused for a
 * different batch).
 *
 * Unlike `fill-landing-dates-2026-08-03.ts`, this script OVERWRITES
 * already-non-empty values on purpose — there is no "write only into empty"
 * guard here. Each row below states the current value AND the target value;
 * the intent is a correction, not a fill-in.
 *
 * Rules:
 *   - Only through app logic: `getFunnel`/`updateFunnel` from
 *     `../src/lib/funnels.ts`. No raw SQL against `funnels`.
 *   - Identity check before writing: each row names its `front_code`. For
 *     id=17 (no F code assigned) the check is instead "front_code is empty
 *     AND num === 17". A mismatch aborts that row (logs an error) without
 *     touching it; the run continues with the rest.
 *   - Idempotent: a field already equal to its target is left untouched and
 *     logged as SKIP. Safe to run twice.
 *   - The patch object for each row only ever contains the fields listed
 *     under that row below — nothing else on the funnel is touched.
 *
 * Row 3 (id=20, f28): source changes from "ВК БАИНГ" to "ВК ИНХАУЗ" — an
 * existing row in `sources` (id=17 at authoring time), not a new one.
 * `updateFunnel` resolves it via the `sourceName` field, which only ever
 * touches `funnels.source_id`; it does NOT flow through `hasAxes` (that
 * gate only fires on product/contractor/channel/direction/funnelType), so
 * this write does not trigger a tag resync by itself. Axes (product=БОО,
 * contractor=ИНХАУЗ, channel=ВК, direction=Реклама) were already correct
 * before this run — verified by reading `funnel_tags` directly — so the
 * tag set is expected to come out identical. The script reads and prints
 * funnel_tags for id=20 before and after regardless, to confirm this
 * empirically rather than assume it.
 * Basis: LeakEngine (`/app-api/api/admin/funnels`) reports f28 = «БОО /
 * ИНХАУЗ / ВК / Реклама», ACTIVE.
 *
 * Row 4 (id=78, f84): status draft -> active. Basis: LeakEngine reports
 * f84 = «ДБО / ИНХАУЗ / ВК / Реклама», ACTIVE; axes and landing already
 * match, so only the status column moves.
 *
 * Run from app/:
 *   npx tsx scripts/sync-leak-2026-08-04.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { getFunnel, updateFunnel } from '../src/lib/funnels';
import { sources, funnelTags, tags } from '../src/db/schema';
import { type FunnelUpdate } from '../src/lib/validation';

type Identity =
  | { kind: 'frontCode'; frontCode: string }
  | { kind: 'noCode'; num: number };

type Row = {
  id: number;
  label: string;
  identity: Identity;
  patch: {
    startDate?: string;
    landingUrl?: string;
    sourceName?: string;
    status?: 'active' | 'draft' | 'archive';
  };
};

const ROWS: Row[] = [
  {
    id: 32,
    label: 'id=32 f31 — только дата старта',
    identity: { kind: 'frontCode', frontCode: 'f31' },
    patch: { startDate: '2026-05-10' },
  },
  {
    id: 17,
    label: 'id=17 (без кода, num=17) — только дата старта',
    identity: { kind: 'noCode', num: 17 },
    patch: { startDate: '2026-04-10' },
  },
  {
    id: 20,
    label: 'id=20 f28 — источник, лендинг, дата',
    identity: { kind: 'frontCode', frontCode: 'f28' },
    patch: {
      sourceName: 'ВК ИНХАУЗ',
      landingUrl: 'https://t.ksamata.ru/inhaus/boo/a',
      startDate: '2026-06-05',
    },
  },
  {
    id: 78,
    label: 'id=78 f84 — только статус',
    identity: { kind: 'frontCode', frontCode: 'f84' },
    patch: { status: 'active' },
  },
];

function sourceNameById(sourceId: number): string {
  const row = db.select({ name: sources.name }).from(sources).where(eq(sources.id, sourceId)).get() as
    | { name: string }
    | undefined;
  return row?.name ?? '(неизвестно)';
}

function dumpTags(funnelId: number): string[] {
  const rows = db
    .select({ tagType: funnelTags.tagType, position: funnelTags.position, name: tags.name })
    .from(funnelTags)
    .innerJoin(tags, eq(tags.id, funnelTags.tagId))
    .where(eq(funnelTags.funnelId, funnelId))
    .all() as { tagType: string; position: number; name: string }[];
  return rows
    .sort((a, b) => (a.tagType === b.tagType ? a.position - b.position : a.tagType.localeCompare(b.tagType)))
    .map((r) => `${r.tagType}#${r.position} ${r.name}`);
}

function checkIdentity(row: Row, funnel: NonNullable<ReturnType<typeof getFunnel>>): string | null {
  if (row.identity.kind === 'frontCode') {
    if (funnel.frontCode !== row.identity.frontCode) {
      return `ожидался front_code=${row.identity.frontCode}, в базе "${funnel.frontCode}"`;
    }
    return null;
  }
  // noCode: front_code must be empty AND num must match
  if (funnel.frontCode !== '') {
    return `ожидался пустой front_code, в базе "${funnel.frontCode}"`;
  }
  if (funnel.num !== row.identity.num) {
    return `ожидался num=${row.identity.num}, в базе num=${funnel.num}`;
  }
  return null;
}

function run(): void {
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of ROWS) {
    const funnel = getFunnel(db, row.id);
    if (!funnel) {
      console.log(`${row.label}: ОШИБКА — воронка id=${row.id} не найдена`);
      errors++;
      continue;
    }

    const identityError = checkIdentity(row, funnel);
    if (identityError) {
      console.log(`${row.label}: ОШИБКА — ${identityError}. Пропускаю строку.`);
      errors++;
      continue;
    }

    console.log(`${row.label} (id=${row.id}):`);

    const tagsBefore = row.id === 20 ? dumpTags(20) : null;

    const patch: FunnelUpdate = {};
    const notes: string[] = [];

    if (row.patch.startDate !== undefined) {
      if (funnel.startDate === row.patch.startDate) {
        notes.push(`start_date: SKIP (уже такое: ${funnel.startDate})`);
      } else {
        patch.startDate = row.patch.startDate;
        notes.push(`start_date: "${funnel.startDate}" -> "${row.patch.startDate}"`);
      }
    }

    if (row.patch.landingUrl !== undefined) {
      if (funnel.landingUrl === row.patch.landingUrl) {
        notes.push(`landing_url: SKIP (уже такое: ${funnel.landingUrl})`);
      } else {
        patch.landingUrl = row.patch.landingUrl;
        notes.push(`landing_url: "${funnel.landingUrl}" -> "${row.patch.landingUrl}"`);
      }
    }

    if (row.patch.sourceName !== undefined) {
      const currentSourceName = sourceNameById(funnel.sourceId);
      if (currentSourceName === row.patch.sourceName) {
        notes.push(`source: SKIP (уже такое: ${currentSourceName})`);
      } else {
        patch.sourceName = row.patch.sourceName;
        notes.push(`source: "${currentSourceName}" -> "${row.patch.sourceName}"`);
      }
    }

    if (row.patch.status !== undefined) {
      if (funnel.status === row.patch.status) {
        notes.push(`status: SKIP (уже такое: ${funnel.status})`);
      } else {
        patch.status = row.patch.status;
        notes.push(`status: "${funnel.status}" -> "${row.patch.status}"`);
      }
    }

    for (const note of notes) console.log(`  ${note}`);

    if (Object.keys(patch).length === 0) {
      console.log('  SKIP: нечего писать');
      skipped++;
      continue;
    }

    updateFunnel(db, row.id, patch);
    console.log('  UPDATED');
    updated++;

    if (row.id === 20) {
      const tagsAfter = dumpTags(20);
      const before = tagsBefore ?? [];
      const same =
        before.length === tagsAfter.length && before.every((v, i) => v === tagsAfter[i]);
      console.log('  funnel_tags(id=20) ДО:');
      before.forEach((l) => console.log(`    ${l}`));
      console.log('  funnel_tags(id=20) ПОСЛЕ:');
      tagsAfter.forEach((l) => console.log(`    ${l}`));
      console.log(`  Теги ${same ? 'НЕ изменились' : 'ИЗМЕНИЛИСЬ'}`);
    }
  }

  console.log(`\nИтого: обновлено=${updated}, пропущено=${skipped}, ошибок=${errors}`);
}

run();
