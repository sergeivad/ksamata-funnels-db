/**
 * Фоновый планировщик проверок. Живёт внутри того же контейнера, что и приложение,
 * поэтому внешний cron не нужен. Инстанс один — гонок нет; на всякий случай
 * наложение циклов дополнительно ловит флаг занятости в monitor-run.
 */
import { runMonitorCycle } from './monitor-run';

export const DEFAULT_INTERVAL_MINUTES = 15;

// Даём entrypoint-миграциям и прогреву сервера закончиться до первого прогона.
const FIRST_RUN_DELAY_MS = 30_000;

export interface SchedulerConfig {
  enabled: boolean;
  intervalMs: number;
  firstRunDelayMs: number;
}

export function readSchedulerConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): SchedulerConfig {
  // Выключает ровно строка 'false' — как ADMIN_AUTH_DISABLED в middleware:
  // случайная опечатка не должна молча отключить мониторинг.
  const enabled = env.MONITOR_ENABLED !== 'false';

  const raw = env.MONITOR_INTERVAL_MINUTES ?? '';
  const minutes = /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : DEFAULT_INTERVAL_MINUTES;

  return {
    enabled,
    intervalMs: minutes * 60_000,
    firstRunDelayMs: FIRST_RUN_DELAY_MS,
  };
}

let started = false;

export function startMonitorScheduler(): void {
  if (started) return;
  started = true;

  const config = readSchedulerConfig(process.env);
  if (!config.enabled) {
    console.log('[monitor] MONITOR_ENABLED=false — фоновые проверки выключены');
    return;
  }

  console.log(`[monitor] планировщик запущен, интервал ${config.intervalMs / 60_000} мин`);

  const tick = async () => {
    try {
      // Импорт клиента БД отложен: модуль читает файл БД на импорте, а
      // планировщик не должен ронять старт сервера, если путь ещё не готов.
      const { db } = await import('../db/client');
      const result = await runMonitorCycle(db);
      if (result === null) {
        console.log('[monitor] предыдущий цикл ещё идёт — пропускаем тик');
        return;
      }
      console.log(
        `[monitor] цикл завершён: проверено ${result.checked}, up ${result.up}, slow ${result.slow}, down ${result.down}`
      );
    } catch (err) {
      console.error('[monitor] цикл упал', err);
    }
  };

  setTimeout(tick, config.firstRunDelayMs);
  setInterval(tick, config.intervalMs);
}
