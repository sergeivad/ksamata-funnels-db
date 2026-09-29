'use client';

import { Copy, Check, AlertCircle } from 'lucide-react';
import { useCopyFlash } from '@/lib/clipboard';

/**
 * Маленькая кнопка «скопировать адрес» с подписью (GC / Web). Нужна
 * повторам: поле повтора показывает код комнаты, а в рассылку берут полную
 * ссылку — ГетКурса или комнаты на нашем домене. Адрес на домене
 * start.bizon365.ru — та же комната, отдельной кнопки у него нет, чтобы не
 * путать с Web (решение владельца 29.09.2026).
 */
export default function CopyChip({ label, url }: { label: string; url: string }) {
  const { status, copy } = useCopyFlash(1500);
  return (
    <button
      type="button"
      onClick={() => copy(url)}
      title={status === 'failed' ? 'Не удалось скопировать' : url}
      className={`inline-flex items-center gap-0.5 rounded-[4px] border px-1.5 py-px text-[10px] transition ${
        status === 'copied'
          ? 'border-[#A6E0BE] bg-[#DFF3E7] text-[#087443]'
          : status === 'failed'
            ? 'border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]'
            : 'border-[#DDD2F7] bg-white text-[#6B4FBB] hover:border-[#6B4FBB]'
      }`}
    >
      {status === 'copied' ? <Check size={10} /> : status === 'failed' ? <AlertCircle size={10} /> : <Copy size={10} />}
      {label}
    </button>
  );
}
