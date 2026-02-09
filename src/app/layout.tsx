import type { Metadata } from "next";
import "@/app/globals.css";
import { AppNav } from "@/components/AppNav";

export const metadata: Metadata = {
  title: "Financas Pessoais | Sheets",
  description: "MVP de financas pessoais integrado ao Google Sheets"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        <AppNav />
        <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-32">{children}</main>
      </body>
    </html>
  );
}
