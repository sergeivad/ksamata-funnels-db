'use client';

import { useState } from 'react';
import { Check, ChevronDown, ListTree } from 'lucide-react';
import { AXIS_ORDER, type AxisKey, type GroupBy } from '@/lib/funnel-facets';

export type { GroupBy };

// Подпись в кнопке читается фразой «По продукту», поэтому оси здесь в
// дательном падеже. Порядок берём из осей: ряд пилюль фильтра, пункты меню
// и порядок drill-down — это одно и то же сверху вниз.
const AXIS_DATIVE: Record<AxisKey, string> = {
  product: 'продукту',
  contractor: 'подрядчику',
  channel: 'каналу',
  direction: 'направлению',
};

function optionLabel(value: GroupBy): string {
  if (value === 'none') return 'Без группировки';
  const word = AXIS_DATIVE[value];
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function buttonLabel(value: GroupBy): string {
  return value === 'none' ? 'Без группировки' : `По ${AXIS_DATIVE[value]}`;
}

const OPTIONS: GroupBy[] = [...AXIS_ORDER, 'none'];

interface GroupToggleProps {
  value: GroupBy;
  onChange: (value: GroupBy) => void;
}

/**
 * Группировка списка — меню, а не ряд кнопок. Пять кнопок были самым
 * тяжёлым элементом над списком, хотя переключают их реже всего:
 * это настройка вида, а не фильтр.
 */
export default function GroupToggle({ value, onChange }: GroupToggleProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Группировка воронок"
        className="inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[13px] text-[var(--color-text-secondary)] transition hover:bg-[var(--chip)] hover:text-[var(--color-text)]"
      >
        <ListTree className="h-4 w-4" />
        {buttonLabel(value)}
        <ChevronDown className="h-3 w-3" strokeWidth={3} />
      </button>

      {open && (
        <>
          {/* Клик мимо закрывает меню — как у пилюль фильтра. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            aria-label="Группировать по"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
            className="absolute right-0 top-[34px] z-20 min-w-[200px] rounded-[8px] border border-[var(--color-border-soft)] bg-white p-1 shadow-lg"
          >
            <div className="px-2 pb-1 pt-1.5 text-[11px] uppercase tracking-[0.04em] text-[var(--faint)]">
              Группировать по
            </div>
            {OPTIONS.map((opt) => {
              const selected = opt === value;
              return (
                <button
                  key={opt}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    setOpen(false);
                    onChange(opt);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-[6px] px-2 py-[6px] text-left text-[13px] text-[var(--color-text)] transition hover:bg-[#F5F3EE] ${
                    selected ? 'font-semibold' : ''
                  }`}
                >
                  {optionLabel(opt)}
                  {selected && <Check className="h-3.5 w-3.5 text-[var(--orange)]" strokeWidth={2.5} />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </span>
  );
}
