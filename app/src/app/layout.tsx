import type { Metadata } from "next";
import "./globals.css";
import AppHeader from "@/components/AppHeader";
import { AuthProvider } from "@/components/AuthProvider";
import { getViewer } from "@/lib/auth-server";

export const metadata: Metadata = {
  // Одна форма названия на весь сервис — та же, что в шапке (`AppHeader`).
  // Заголовок видно на вкладке браузера, в закладках и в истории; в карточках
  // предпросмотра он больше не появляется — превью-ботам мидлвара отвечает
  // пустотой (см. `@/lib/link-preview`).
  title: "Ксамата · Воронки",
  description: "База автоворонок Ксаматы",
  // Сервис читается публично, но индексировать его незачем: в карточках URL
  // лендов и внутренние комментарии. Дублируется заголовком X-Robots-Tag в
  // мидлваре — мета-тег не покрывает ответы API.
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Права считаются на сервере при каждом рендере: клиенту незачем знать, как
  // устроена сессия, а серверные компоненты рендерятся заново после
  // router.refresh() — им заканчиваются и вход, и выход.
  const viewer = await getViewer();

  return (
    <html lang="ru">
      <body>
        <AuthProvider value={viewer}>
          <AppHeader />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
