"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Início", icon: (active: boolean) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  )},
  { href: "/lancar", label: "Lançar", icon: (active: boolean) => (
    <div className={`p-3 rounded-2xl -mt-8 shadow-xl transition-all ${active ? "bg-ink text-sand scale-110" : "bg-pine text-white"}`}>
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    </div>
  )},
  { href: "/cartoes", label: "Cartões", icon: (active: boolean) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
    </svg>
  )},
  { href: "/relatorios", label: "Mais", icon: (active: boolean) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  )}
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Top bar minimalista */}
      <nav className="sticky top-0 z-40 w-full bg-sand/80 backdrop-blur-md border-b border-ink/5 px-6 h-14 flex items-center justify-between">
        <span className="text-sm font-black uppercase tracking-widest text-ink/40">FinançasG</span>
        <div className="flex gap-4">
          <Link href="/importar" className="text-ink/30 hover:text-ink transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
          </Link>
          <Link href="/contas-fixas" className="text-ink/30 hover:text-ink transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 12h8.25" />
            </svg>
          </Link>
        </div>
      </nav>

      {/* Bottom Bar fixa */}
      <nav className="fixed bottom-0 left-0 z-50 w-full bg-white/90 backdrop-blur-xl border-t border-ink/5 px-6 pb-6 pt-2">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex flex-col items-center gap-1 transition-all ${
                  active ? "text-ink" : "text-ink/30"
                }`}
              >
                {link.icon(active)}
                {link.label !== "Lançar" && (
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${active ? "opacity-100" : "opacity-0"}`}>
                    {link.label}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
