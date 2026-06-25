import { notFound } from 'next/navigation';
import { db } from '@/db/client';
import { getFunnel } from '@/lib/funnels';
import { listDays } from '@/lib/funnel-days';
import FunnelForm from '@/components/FunnelForm';
import DaysEditor from '@/components/DaysEditor';

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

  const initialDays = listDays(db, numId);

  return (
    <>
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
          axes: funnel.axes,
        }}
      />
      <DaysEditor funnelId={numId} initialDays={initialDays} />
    </>
  );
}
