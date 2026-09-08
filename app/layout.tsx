import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PITCHAT",
  description: "Automação de Instagram, Media Library e Inbox — fonte de verdade interna.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
