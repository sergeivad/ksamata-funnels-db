// Единый источник правды по статусам мониторинга. Значения совпадают с
// CHECK-ограничением колонки monitor_state.status.
export const MONITOR_STATUS_VALUES = ['up', 'slow', 'down', 'unknown'] as const;
export type MonitorStatus = (typeof MONITOR_STATUS_VALUES)[number];

export function isMonitorStatus(v: unknown): v is MonitorStatus {
  return typeof v === 'string' && (MONITOR_STATUS_VALUES as readonly string[]).includes(v);
}

// Бейдж + порядок сортировки в таблице: сначала то, что требует внимания.
export const MONITOR_STATUS_META: Record<
  MonitorStatus,
  { label: string; className: string; order: number }
> = {
  down:    { label: 'Упало',          className: 'bg-[#FBE3E3] text-[#A32020]', order: 0 },
  slow:    { label: 'Медленно',       className: 'bg-[#FCF0D8] text-[#8A6100]', order: 1 },
  unknown: { label: 'Не проверялось', className: 'bg-[#E8E4DA] text-[#5E5A52]', order: 2 },
  up:      { label: 'Работает',       className: 'bg-[#DFF3E7] text-[#087443]', order: 3 },
};

/**
 * «Сколько прошло» для времени из SQLite (`datetime('now')` → 'YYYY-MM-DD HH:MM:SS' в UTC,
 * без указания зоны). Пробел меняем на 'T' и дописываем 'Z', иначе движок трактует
 * строку как локальное время и сдвигает результат на часовой пояс.
 */
export function formatAgo(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return 'никогда';
  const normalized = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
  const then = Date.parse(normalized);
  if (Number.isNaN(then)) return 'никогда';

  const seconds = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (seconds < 60) return 'только что';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}
