import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { db } from '@/db/client';
import { getFunnel } from '@/lib/funnels';
import { listDays } from '@/lib/funnel-days';
import { listBlocks } from '@/lib/funnel-blocks';
import FunnelSections from '@/components/FunnelSections';

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
      <FunnelSections funnel={funnel} funnelId={numId} initialDays={initialDays} landings={landings} rest={rest} />
    </main>
  );
}
