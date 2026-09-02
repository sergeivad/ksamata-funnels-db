'use client';
interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  /** Режим просмотра: положение видно, но не переключается. */
  disabled?: boolean;
}
export default function Switch({ checked, onChange, label, disabled = false }: Props) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label && <span className="text-[11px] text-[var(--muted)]">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        // Видимая подпись — соседний span, а не <label for>, поэтому скринридер
        // сам её к кнопке не привяжет: без этого все переключатели сервиса
        // читаются как безымянные «переключатель, включено».
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative inline-block h-[17px] w-[30px] rounded-full transition disabled:cursor-default disabled:opacity-60"
        style={{ background: checked ? 'var(--orange)' : 'var(--line)' }}
      >
        <span className="absolute top-[2px] h-[13px] w-[13px] rounded-full bg-white transition-all" style={{ left: checked ? '15px' : '2px' }} />
      </button>
    </span>
  );
}
