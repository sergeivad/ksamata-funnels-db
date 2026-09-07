/**
 * ЦЕЛЬ — БАЗА РЕПОЗИТОРИЯ (корневой `ksamata_funnels.db`). Прод не трогает —
 * там f19 уже `active`, править нечего.
 *
 * ЗАЧЕМ. 07.09.2026 репозиторную базу выровняли по проду прогоном
 * `sync-repo-from-prod-2026-08-28.ts`. Тот скрипт переносит воронки, дни и
 * блоки, но статус СУЩЕСТВУЮЩЕЙ воронки не трогает: `updateFunnel` он зовёт
 * только для вновь созданных воронок и для `roomsEnabled`. После прогона
 * осталось ровно одно расхождение по полям воронок — f19: `archive` у нас,
 * `active` на проде (остальные 78 воронок сходятся по статусу дословно).
 * Решение владельца 07.09.2026: выровнять по проду, снять архив.
 *
 * ПОБОЧНЫЙ ЭФФЕКТ. Мониторинг собирает цели только с воронок в статусе
 * `active` (`MONITORED_FUNNEL_STATUS` в `app/src/lib/monitor-targets.ts`),
 * поэтому после снятия архива три лендинга f19 попадут в область проверки на
 * ближайшей синхронизации. Таблицы `monitor_*` в репозиторной базе при этом
 * обязаны оставаться пустыми (см. CLAUDE.md) — этот скрипт их не трогает и
 * никакую синхронизацию не запускает.
 *
 * ПРАВИЛА:
 *   - Воронка ищется по F-коду (`normalizeFrontCode`); нет такого кода в
 *     базе — внятная ошибка, exit 1.
 *   - Статус меняется ТОЛЬКО через `updateFunnel` из `../src/lib/funnels`
 *     (сырой SQL по воронкам запрещён, см. CLAUDE.md).
 *   - Идемпотентность — проверкой ДО записи: если текущий статус уже не
 *     `archive`, ничего не пишем.
 *       · уже `active` — прогон уже был, это НЕ ошибка, exit 0;
 *       · любой третий статус (`draft` и т.п.) — неожиданное состояние,
 *         ошибка, exit 1: скрипт написан под конкретное расхождение
 *         «archive → active» и не вправе молча решать за оператора, что
 *         делать с чем-то другим.
 *
 * Путь к базе — `resolveCliDbPath()` (см. `scripts/cli-db-path.ts`): дефолт —
 * корневой `ksamata_funnels.db` относительно расположения ЭТОГО файла (не от
 * cwd), либо `FUNNELS_DB_PATH`, если задан.
 *
 * Запуск из `app/`:
 *   npx tsx scripts/unarchive-f19-2026-09-07.ts --dry-run
 *   npx tsx scripts/unarchive-f19-2026-09-07.ts --apply
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema';
import { resolveCliDbPath } from './cli-db-path';
import { updateFunnel } from '../src/lib/funnels';
import { normalizeFrontCode } from '../src/lib/front-code';

const TARGET_CODE = 'f19';
const TARGET_STATUS = 'active' as const;

function main(): void {
  const apply = process.argv.includes('--apply');
  const dryRun = process.argv.includes('--dry-run');
  if (apply === dryRun) {
    console.error('Укажи ровно один режим: --dry-run или --apply');
    process.exit(2);
  }

  const dbPath = resolveCliDbPath();
  console.log(`База: ${dbPath}`);
  console.log(`Режим: ${dryRun ? 'ПРОБНЫЙ (ничего не пишем)' : 'ЗАПИСЬ'}\n`);

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  const code = normalizeFrontCode(TARGET_CODE);
  const funnel = db
    .select({ id: schema.funnels.id, frontCode: schema.funnels.frontCode, status: schema.funnels.status })
    .from(schema.funnels)
    .all()
    .find((r) => normalizeFrontCode(r.frontCode ?? '') === code);

  if (!funnel) {
    console.error(`Воронка с F-кодом ${TARGET_CODE} не найдена в базе.`);
    sqlite.close();
    process.exit(1);
  }

  console.log(`Найдена воронка ${funnel.frontCode} (id=${funnel.id}), текущий статус: ${funnel.status}`);

  if (funnel.status !== 'archive') {
    if (funnel.status === TARGET_STATUS) {
      console.log(
        `Статус уже «${TARGET_STATUS}» — прогон, видимо, уже был. Ничего не пишем.`
      );
      sqlite.close();
      process.exit(0);
    }
    console.error(
      `Неожиданный статус «${funnel.status}»: скрипт умеет только переход archive → ${TARGET_STATUS}. ` +
        'Ничего не пишем — разбираться нужно руками.'
    );
    sqlite.close();
    process.exit(1);
  }

  if (dryRun) {
    console.log(`Записал бы: ${funnel.frontCode} archive → ${TARGET_STATUS}`);
    sqlite.close();
    return;
  }

  const updated = updateFunnel(db, funnel.id, { status: TARGET_STATUS });
  if (!updated) {
    console.error('updateFunnel вернул null — воронка исчезла между чтением и записью?');
    sqlite.close();
    process.exit(1);
  }

  console.log(`Готово: ${funnel.frontCode} теперь «${updated.status}».`);
  sqlite.close();
}

main();
