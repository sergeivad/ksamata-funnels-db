import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { db } from '@/db/client';
import { getFunnel } from '@/lib/funnels';
import { listDays } from '@/lib/funnel-days';
import { listBlocks } from '@/lib/funnel-blocks';
import FunnelIdentity from '@/components/FunnelIdentity';
import RoomsEditor from '@/components/RoomsEditor';
import BlockEditor from '@/components/BlockEditor';

interface PageProps { params: Promise<{ id: string }> }

export default async function FunnelEditPage({ params }: PageProps) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) notFound();

  const funnel = getFunnel(db, numId);
  if (!funnel) notFound();

  const initialDays = listDays(db, numId);
  const blocks = listBlocks(db, numId);
  const landings = blocks.find((b) => b.kind === 'landings')!;
  const rest = blocks.filter((b) => b.kind !== 'landings');

  return (
    <main className="mx-auto max-w-[1120px] px-6 py-8">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1 text-[13px] text-[var(--muted)] transition hover:text-[var(--ink)]"
      >
        <ChevronLeft size={15} /> Все воронки
      </Link>
      <FunnelIdentity funnel={funnel} />
      <div className="my-4 h-px bg-[var(--line-soft)]" />
      {/* Order: landings → rooms → remaining blocks (records, tariffs, ...) */}
      <BlockEditor funnelId={numId} initial={landings} timeLabelA={funnel.timeLabelA} timeLabelB={funnel.timeLabelB} />
      <RoomsEditor funnelId={numId} initialDays={initialDays} replayEnabled={funnel.roomsReplayEnabled}
        timeLabelA={funnel.timeLabelA} timeLabelB={funnel.timeLabelB} />
      {rest.map((b) => (
        <BlockEditor key={b.kind} funnelId={numId} initial={b} timeLabelA={funnel.timeLabelA} timeLabelB={funnel.timeLabelB} />
      ))}
    </main>
  );
}
