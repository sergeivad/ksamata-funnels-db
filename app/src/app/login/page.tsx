import { redirect } from 'next/navigation';
import LoginForm from '@/components/LoginForm';
import { getViewer } from '@/lib/auth-server';

interface PageProps {
  searchParams: Promise<{ next?: string }>;
}

/**
 * Форма входа для редактора. Просмотр сервиса вход не требует — сюда попадают
 * либо по кнопке «Войти», либо редиректом мидлвары с закрытой страницы.
 */
export default async function LoginPage({ searchParams }: PageProps) {
  const { next } = await searchParams;

  // Возврат только на внутренний путь: `//host` браузер трактует как абсолютный
  // URL, поэтому одной проверки на ведущий слэш мало — иначе ссылка вида
  // /login?next=//evil.example уводила бы человека с нашей формы на чужой сайт.
  const target = typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const viewer = await getViewer();
  if (viewer.canEdit) redirect(target);

  return (
    <main className="mx-auto max-w-[380px] px-6 py-16">
      <h1 className="mb-1 text-[18px] font-semibold text-[var(--ink)]">Вход</h1>
      <p className="mb-5 text-[12px] text-[var(--muted)]">
        Просмотр доступен всем. Вход нужен, чтобы править воронки, справочники, теги
        и управлять мониторингом.
      </p>
      <LoginForm next={target} />
    </main>
  );
}
