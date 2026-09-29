'use client';

import { Copy, Check, AlertCircle } from 'lucide-react';
import { useCopyFlash } from '@/lib/clipboard';

/**
 * Маленькая кнопка «скопировать адрес» с подписью (GC / Web / Бизон). Нужна
 * повторам: один повтор живёт под тремя адресами (room-urls.ts), и в рассылку
 * берут то один, то другой — поле показывает один, копируются все три.
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
