'use client';

export type GroupBy = 'contractor' | 'product' | 'none';

interface GroupToggleProps {
  value: GroupBy;
  onChange: (value: GroupBy) => void;
}

const OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'contractor', label: 'По подрядчику' },
  { value: 'product', label: 'По продукту' },
  { value: 'none', label: 'Без группировки' },
];

export default function GroupToggle({ value, onChange }: GroupToggleProps) {
  return (
    <div
      role="group"
      aria-label="Группировка воронок"
      className="inline-flex rounded-[8px] border border-[var(--color-border-soft)] bg-[rgba(255,255,255,0.38)] p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={[
              'rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition',
              active
                ? 'bg-[#111111] text-white shadow-[0_1px_2px_rgba(0,0,0,0.15)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
            ].join(' ')}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
