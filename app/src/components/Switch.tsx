'use client';
interface Props { checked: boolean; onChange: (v: boolean) => void; label?: string }
export default function Switch({ checked, onChange, label }: Props) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label && <span className="text-[11px] text-[var(--muted)]">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative inline-block h-[17px] w-[30px] rounded-full transition"
        style={{ background: checked ? 'var(--orange)' : 'var(--line)' }}
      >
        <span className="absolute top-[2px] h-[13px] w-[13px] rounded-full bg-white transition-all" style={{ left: checked ? '15px' : '2px' }} />
      </button>
    </span>
  );
}
