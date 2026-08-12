import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { db } from '@/db/client';
import { getFunnel, getFunnelByFrontCode } from '@/lib/funnels';
import { parseFunnelRef, funnelHref } from '@/lib/front-code';
import { listDays } from '@/lib/funnel-days';
import { listBlocks } from '@/lib/funnel-blocks';
import FunnelSections from '@/components/FunnelSections';

interface PageProps { params: Promise<{ ref: string }> }

export default async function FunnelEditPage({ params }: PageProps) {
  const { ref } = await params;
  const parsed = parseFunnelRef(ref);
  if (!parsed) notFound();

  // Сначала ищем воронку, и только потом решаем про редирект: /funnels/F99,
  // где такой воронки нет, должен отдать 404 сразу, а не вести через переход
  // на /funnels/f99, который тоже 404 — иначе на каждую опечатку лишний
  // переход, а в адресной строке оседает несуществующий код.
  const funnel = parsed.kind === 'code'
    ? getFunnelByFrontCode(db, parsed.code)
    : getFunnel(db, parsed.id);
  if (!funnel) notFound();

  // Канон — F-код. Числовой адрес и ненормализованный код работают вечно, но
  // уводят на канон. Одно сравнение закрывает все случаи: «83» → «/funnels/f86»,
  // «F86» → «/funnels/f86», «083» → «/funnels/f86», а у воронки без кода
  // «7» совпадает с каноном и перехода не будет.
  //
  // Переход ВРЕМЕННЫЙ (redirect даёт 307), а не постоянный: 308 браузер
  // кеширует навсегда, а код редактируемый — поменяли f86 на f90, и
  // закешированный переход годами водит на 404.
  //
  // Заодно лечит вторую ловушку: увидев на карточке «F86», человек набирает
  // /funnels/86 руками. 86 — валидный id, и без перехода страница молча
  // показала бы чужую воронку; теперь адресная строка сразу покажет чужой код.
  const canonical = funnelHref(funnel);
  if (`/funnels/${ref}` !== canonical) redirect(canonical);

  const initialDays = listDays(db, funnel.id);
  const blocks = listBlocks(db, funnel.id);
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
      <FunnelSections funnel={funnel} funnelId={funnel.id} initialDays={initialDays} landings={landings} rest={rest} />
    </main>
  );
}
