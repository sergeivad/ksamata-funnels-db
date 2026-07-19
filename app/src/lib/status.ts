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
