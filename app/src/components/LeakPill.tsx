import { leakPillState } from '@/lib/leak-pill';

/**
 * Маленькая пилюля «ЛИК» для строки списка. Размер — как у бывшего чипа
 * типа (11px), чтобы не отъедать колонку статуса. Заведённая воронка —
 * спокойная сплошная пилюля; незаведённая — пустая рамка тёплого цвета:
 * сигнал «надо завести» должен быть виден, а не читаться по отсутствию.
 */
export default function LeakPill(props: { inLeak: boolean; status: string; blank: boolean }) {
  const state = leakPillState(props);
  if (state === 'in') {
    return (
      <span
        className="rounded bg-[#E4EAF0] px-1.5 py-0.5 text-[11px] text-[#3E5566]"
        title="Воронка заведена в ЛИК, аналитика по ней есть"
      >
        ЛИК
      </span>
    );
  }
  if (state === 'missing') {
    return (
      <span
        className="rounded border border-dashed border-[#D9822B] px-1.5 py-[1px] text-[11px] text-[#A8581A]"
        title="Воронки нет в ЛИК: аналитики по ней нет, её нужно завести. Заведёте — поставьте галку «Есть в ЛИК» на карточке"
      >
        нет в ЛИК
      </span>
    );
  }
  return null;
}
