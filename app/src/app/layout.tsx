import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ksamata Funnels Admin",
  description: "Admin panel for managing Ksamata marketing funnels",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
