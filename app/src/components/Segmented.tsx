'use client';
interface Props { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }
export default function Segmented({ options, value, onChange }: Props) {
  return (
    <span className="inline-flex gap-[2px] rounded-[7px] bg-[var(--chip)] p-[2px]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="rounded-[5px] px-2.5 py-[3px] text-[11px]"
            style={active ? { background: '#fff', color: 'var(--ink)' } : { color: 'var(--faint)' }}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}
