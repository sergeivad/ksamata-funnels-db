import { notFound } from 'next/navigation';
import { db } from '@/db/client';
import { getFunnel } from '@/lib/funnels';
import { listRefs } from '@/lib/refs';
import FunnelForm from '@/components/FunnelForm';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function FunnelEditPage({ params }: PageProps) {
  const { id } = await params;
  const numId = parseInt(id, 10);

  if (isNaN(numId)) {
    notFound();
  }

  const funnel = getFunnel(db, numId);
  if (!funnel) {
    notFound();
  }

  // Resolve sourceName from sourceId
  const sources = listRefs(db, 'sources');
  const sourceRow = sources.find((s) => s.id === funnel.sourceId);
  const sourceName = sourceRow?.name ?? '';

  return (
    <FunnelForm
      mode="edit"
      initial={{
        id: funnel.id,
        num: funnel.num,
        frontCode: funnel.frontCode,
        status: (funnel.status === 'active' ? 'active' : 'draft') as 'active' | 'draft',
        productName: funnel.productName,
        variant: funnel.variant,
        landingUrl: funnel.landingUrl,
        startDate: funnel.startDate,
        blockName: funnel.blockName,
        axes: funnel.axes,
        sourceName,
      }}
    />
  );
}
