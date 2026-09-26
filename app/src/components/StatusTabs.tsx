'use client';

import type { StatusFilter } from '@/lib/status';

interface StatusTabsProps {
  options: { value: StatusFilter; label: string }[];
  value: StatusFilter;
  counts: Record<StatusFilter, number>;
  onChange: (value: StatusFilter) => void;
}

/**
 * Вкладки статуса над списком. Отдельно от `Segmented`, потому что здесь
 * статус — раздел списка, а не одна из настроек: вкладки стоят первой строкой
 * и несут число воронок в разделе.
 */
export default function StatusTabs({ options, value, counts, onChange }: StatusTabsProps) {
  return (
    <div
      role="group"
      aria-label="Статус воронок"
      className="flex flex-wrap gap-x-6 border-b border-[var(--color-border-soft)]"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={[
              '-mb-px border-b-2 pb-2 text-[14px] transition',
              active
                ? 'border-[var(--color-text)] text-[var(--color-text)]'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
            ].join(' ')}
          >
            {o.label}
            <span className="ml-1.5 text-[12px] text-[var(--faint)]">{counts[o.value]}</span>
          </button>
        );
      })}
    </div>
  );
}
