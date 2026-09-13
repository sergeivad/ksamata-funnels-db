'use client';

import { AXIS_LABEL, AXIS_ORDER, type GroupBy } from '@/lib/funnel-facets';

export type { GroupBy };

// Подписи и порядок берём из осей, а не держим второй список: ряд кнопок
// группировки, ряд пилюль фильтра и порядок drill-down — это одно и то же
// слева направо, и разъехаться им нельзя.
const OPTIONS: { value: GroupBy; label: string }[] = [
  ...AXIS_ORDER.map((axis) => ({ value: axis as GroupBy, label: AXIS_LABEL[axis] })),
  { value: 'none', label: 'Без группировки' },
];

interface GroupToggleProps {
  value: GroupBy;
  onChange: (value: GroupBy) => void;
}

export default function GroupToggle({ value, onChange }: GroupToggleProps) {
  return (
    <div
      role="group"
      aria-label="Группировка воронок"
      // Осей стало четыре, и пять кнопок в ряд не влезают в телефон: пусть
      // переносятся, а не уезжают за край экрана.
      className="inline-flex max-w-full flex-wrap rounded-[8px] border border-[var(--color-border-soft)] bg-[rgba(255,255,255,0.38)] p-0.5"
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
