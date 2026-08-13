import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { db } from '@/db/client';
import { getFunnel, getFunnelByFrontCode } from '@/lib/funnels';
import { parseFunnelRef, funnelHref, funnelRefSegment } from '@/lib/front-code';
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
  // уводят на канон. Сравниваем не полный путь, а только сегмент после
  // `/funnels/` (его же строит funnelRefSegment) — иначе эта страница сама
  // оказалась бы шестым местом ручной сборки `/funnels/...`, которое ловит
  // сторож funnel-href-consistency.test.ts. Одно сравнение закрывает все
  // случаи: «1» → «/funnels/f37», «F37» → «/funnels/f37», «01» →
  // «/funnels/f37», а у воронки без кода «7» совпадает с каноном и перехода
  // не будет.
  //
  // Переход ВРЕМЕННЫЙ (redirect даёт 307), а не постоянный: 308 браузер
  // кеширует навсегда, а код редактируемый — поменяли f37 на f90, и
  // закешированный переход годами водит на 404.
  //
  // Заодно лечит вторую ловушку: увидев на карточке «F37», человек набирает
  // /funnels/37 руками. 37 — валидный id (той воронки, что называется f29), и
  // без перехода страница молча показала бы чужую воронку; теперь адресная
  // строка сразу покажет чужой код.
  if (ref !== funnelRefSegment(funnel)) redirect(funnelHref(funnel));

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
