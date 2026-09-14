'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import {
  AXIS_LABEL,
  AXIS_ORDER,
  axisOptions,
  hasAxisFilter,
  type AxisFilters,
  type AxisKey,
  type FacetedFunnel,
} from '@/lib/funnel-facets';

interface FacetBarProps {
  /**
   * Список, уже суженный вкладкой статуса и поиском, но ещё НЕ фильтрами
   * осей: счётчики в меню каждой оси считаются без её собственного фильтра
   * (см. `axisOptions`), и вычесть его из готовой выдачи было бы нельзя.
   */
  items: FacetedFunnel[];
  filters: AxisFilters;
  onPick: (axis: AxisKey, value: string) => void;
  onClear: (axis: AxisKey) => void;
  onClearAll: () => void;
}

/**
 * Строка фильтра по осям — четыре пилюли, всегда на экране.
 *
 * Видна она всегда именно потому, что иначе о фильтре нельзя догадаться:
 * клик по заголовку группы делает то же самое, но о нём надо знать заранее.
 * Пилюля показывает текущее значение оси («Продукт: все»), а её меню —
 * значения со счётчиками, так что пустую комбинацию выбрать нельзя.
 */
export default function FacetBar({ items, filters, onPick, onClear, onClearAll }: FacetBarProps) {
  const [openAxis, setOpenAxis] = useState<AxisKey | null>(null);
  const anyActive = AXIS_ORDER.some((axis) => hasAxisFilter(filters, axis));

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--faint)]">Фильтр</span>

      {AXIS_ORDER.map((axis) => (
        <AxisPill
          key={axis}
          axis={axis}
          items={items}
          filters={filters}
          open={openAxis === axis}
          onToggle={() => setOpenAxis((cur) => (cur === axis ? null : axis))}
          onClose={() => setOpenAxis(null)}
          onPick={(value) => {
            setOpenAxis(null);
            onPick(axis, value);
          }}
          onClear={() => {
            setOpenAxis(null);
            onClear(axis);
          }}
        />
      ))}

      {anyActive && (
        <button
          type="button"
          onClick={onClearAll}
          className="px-1 text-[12px] text-[var(--color-text-secondary)] underline hover:text-[var(--color-text)]"
        >
          Сбросить
        </button>
      )}
    </div>
  );
}

interface AxisPillProps {
  axis: AxisKey;
  items: FacetedFunnel[];
  filters: AxisFilters;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onPick: (value: string) => void;
  onClear: () => void;
}

function AxisPill({ axis, items, filters, open, onToggle, onClose, onPick, onClear }: AxisPillProps) {
  const active = hasAxisFilter(filters, axis);
  const current = filters[axis];
  // Считаем только для открытого меню: 79 воронок × 4 оси на каждый ввод в
  // поиске — работа, которую никто не увидит.
  const options = useMemo(
    () => (open ? axisOptions(items, filters, axis) : []),
    [open, items, filters, axis]
  );

  const shellClass = active
    ? 'border-[#FFD2B4] bg-[var(--orange-soft)]'
    : 'border-[var(--color-border-soft)] bg-[rgba(255,255,255,0.38)]';

  return (
    <span className="relative">
      <span
        className={`inline-flex items-center gap-1.5 rounded-[7px] border py-[3px] pl-[9px] pr-1 text-[12px] ${shellClass}`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-haspopup="menu"
          aria-expanded={open}
          title={`Фильтр по оси «${AXIS_LABEL[axis]}»`}
          className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-text)]"
        >
          <span className={active ? 'text-[#8A5A34]' : 'text-[var(--color-text-secondary)]'}>
            {AXIS_LABEL[axis]}:
          </span>
          <span
            className={
              active ? 'font-semibold text-[var(--color-text)]' : 'text-[var(--faint)]'
            }
          >
            {active ? (current === '' ? 'без осей' : current) : 'все'}
          </span>
          <ChevronDown
            className={`h-3 w-3 ${active ? 'text-[#8A5A34]' : 'text-[var(--faint)]'}`}
            strokeWidth={3}
          />
        </button>
        {active && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Снять фильтр по оси «${AXIS_LABEL[axis]}»`}
            title="Снять фильтр"
            className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] text-[#8A5A34] hover:bg-white/60"
          >
            <X className="h-3 w-3" strokeWidth={2.5} />
          </button>
        )}
      </span>

      {open && (
        <>
          {/* Клик мимо закрывает меню; Escape — тоже, поэтому подложка ловит и его. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={onClose}
          />
          <div
            role="menu"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
            className="absolute left-0 top-[30px] z-20 max-h-[260px] min-w-[190px] overflow-y-auto rounded-[8px] border border-[var(--color-border-soft)] bg-white p-1 shadow-lg"
          >
            <MenuRow
              label="Все"
              count={options.reduce((sum, o) => sum + o.count, 0)}
              selected={!active}
              onClick={onClear}
            />
            {options.map((o) => (
              <MenuRow
                key={o.value}
                label={o.label}
                count={o.count}
                selected={active && current === o.value}
                onClick={() => onPick(o.value)}
              />
            ))}
          </div>
        </>
      )}
    </span>
  );
}

function MenuRow({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-[6px] px-2 py-[5px] text-left text-[12px] text-[var(--color-text)] transition hover:bg-[#F5F3EE] ${
        selected ? 'bg-[var(--color-bg)] font-semibold' : ''
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="text-[11px] text-[var(--faint)]">{count}</span>
    </button>
  );
}
