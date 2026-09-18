'use client';

import Link from 'next/link';
import { AlertCircle, HelpCircle } from 'lucide-react';
import {
  funnelHealthTone,
  funnelHealthPillLabel,
  type FunnelHealth,
} from '@/lib/funnel-health';

interface Props {
  health: FunnelHealth;
  href: string;
}

/**
 * Пилюля состояния ссылок. Живёт внутри той же flex-группы, что StatusPill и
 * чип типа воронки: отдельная колонка сетки оставила бы дыру у большинства
 * строк — пилюля есть у меньшинства.
 */
export default function FunnelHealthPill({ health, href }: Props) {
  const tone = funnelHealthTone(health);
  if (tone === 'ok') return null;

  const isDown = tone === 'down';
  const Icon = isDown ? AlertCircle : HelpCircle;

  return (
    <Link
      href={href}
      title={
        isDown
          ? `${health.down} из ${health.total} адресов не отвечают`
          : 'Адреса этой воронки ещё ни разу не проверяли'
      }
      className={[
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition',
        isDown
          ? 'bg-[#FBE3E3] text-[#A32020] hover:bg-[#F7D2D2]'
          : 'bg-[#E8E4DA] text-[#5E5A52] hover:bg-[#DFDACE]',
      ].join(' ')}
    >
      <Icon className="h-3 w-3" />
      {funnelHealthPillLabel(health)}
    </Link>
  );
}
