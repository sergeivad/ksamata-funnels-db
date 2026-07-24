import { MONITOR_STATUS_META, isMonitorStatus } from '@/lib/monitor-status';

interface Props {
  status: string;
}

export default function MonitorStatusPill({ status }: Props) {
  const meta = isMonitorStatus(status) ? MONITOR_STATUS_META[status] : MONITOR_STATUS_META.unknown;
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  );
}
