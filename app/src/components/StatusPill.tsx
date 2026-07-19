import { isFunnelStatus, STATUS_META } from '@/lib/status';

interface StatusPillProps {
  // string, а не FunnelStatus: часть источников (FunnelDetail.status) типизированы
  // как string; неизвестное значение безопасно падает в «Черновик».
  status: string;
}

export default function StatusPill({ status }: StatusPillProps) {
  const meta = isFunnelStatus(status) ? STATUS_META[status] : STATUS_META.draft;
  return (
    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  );
}
