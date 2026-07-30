import type { Metadata } from "next";
import "./globals.css";
import AppHeader from "@/components/AppHeader";
import { AuthProvider } from "@/components/AuthProvider";
import { getViewer } from "@/lib/auth-server";

export const metadata: Metadata = {
  title: "Ksamata Funnels Admin",
  description: "Admin panel for managing Ksamata marketing funnels",
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
