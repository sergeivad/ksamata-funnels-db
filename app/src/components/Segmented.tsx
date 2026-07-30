'use client';
interface Props {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  /** Режим просмотра: выбор виден, но не переключается. */
  disabled?: boolean;
}
export default function Segmented({ options, value, onChange, disabled = false }: Props) {
  return (
    // Выбранный вариант отличался только цветом фона, то есть для скринридера
    // все кнопки читались одинаково и понять текущий выбор было нельзя.
    <span role="group" className="inline-flex gap-[2px] rounded-[7px] bg-[var(--chip)] p-[2px]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className="rounded-[5px] px-2.5 py-[3px] text-[11px] disabled:cursor-default"
            style={active ? { background: '#fff', color: 'var(--ink)' } : { color: 'var(--faint)' }}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}
