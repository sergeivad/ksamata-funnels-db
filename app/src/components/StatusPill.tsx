interface StatusPillProps {
  status: 'active' | 'draft';
}

export default function StatusPill({ status }: StatusPillProps) {
  if (status === 'active') {
    return (
      <span className="rounded-full bg-[#DFF3E7] px-2 py-1 text-[11px] font-semibold text-[#087443]">
        Активна
      </span>
    );
  }
  return (
    <span className="rounded-full bg-[#E8E4DA] px-2 py-1 text-[11px] font-semibold text-[#5E5A52]">
      Черновик
    </span>
  );
}
