import type { Metadata } from "next";
import "@/app/globals.css";
import { AppNav } from "@/components/AppNav";
import { FeatureFlagsProvider } from "@/components/FeatureFlagsProvider";
import { PwaRegistrar } from "@/components/PwaRegistrar";
import { isMobileOfflineModeEnabled } from "@/lib/mobileOffline/flags";

export const metadata: Metadata = {
  title: "Financas Pessoais | Sheets",
  description: "MVP de financas pessoais integrado ao Google Sheets",
  manifest: "/manifest.webmanifest"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const mobileOfflineMode = isMobileOfflineModeEnabled();

  return (
    <html lang="pt-BR">
      <body className="antialiased">
        <FeatureFlagsProvider mobileOfflineMode={mobileOfflineMode}>
          <PwaRegistrar enabled={mobileOfflineMode} />
          <AppNav />
          <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-32">{children}</main>
        </FeatureFlagsProvider>
      </body>
    </html>
  );
}
