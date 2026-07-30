import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth-server';

/**
 * Серверный барьер для страниц, которые целиком редакторские: справочники,
 * шаблон тегов, мониторинг. Анонима уводит на форму входа.
 *
 * Дублирует мидлвару сознательно — по той же причине, что и `requireEditor`
 * в роутах: `matcher` ломается одной правкой и молча, а страницы `/refs` и
 * `/tags` рендерят данные прямо из БД, без похода в API. Решение принимает
 * та же функция, так что два рубежа не разъедутся.
 */
export default async function EditorGate({
  next,
  children,
}: {
  /** Путь для возврата после входа. */
  next: string;
  children: React.ReactNode;
}) {
  const viewer = await getViewer();
  if (!viewer.canEdit) redirect(`/login?next=${encodeURIComponent(next)}`);
  return <>{children}</>;
}
