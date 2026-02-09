"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const primaryLinks = [
  { href: "/", label: "Início", icon: (active: boolean) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  )},
  { href: "/cartoes", label: "Cartões", icon: (active: boolean) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
    </svg>
  )}
];

const moreLinks = [
  { href: "/relatorios", label: "Relatórios" },
  { href: "/importar", label: "Importar" },
  { href: "/contas-fixas", label: "Contas fixas" }
];

export function AppNav() {
  const pathname = usePathname();
  const launchActive = pathname === "/lancar";
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRouteActive = moreLinks.some((item) => item.href === pathname);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Top bar minimalista */}
      <nav className="sticky top-0 z-40 w-full bg-sand/80 backdrop-blur-md border-b border-ink/5 px-6 h-14 flex items-center">
        <span className="text-sm font-black uppercase tracking-widest text-ink/40">FinançasG</span>
      </nav>

      {/* Bottom Nav com base sutil */}
      <nav className="fixed bottom-0 left-0 z-50 w-full px-0 pb-2 pt-0">
        <div className="relative flex w-full flex-col items-center border-t border-ink/10 bg-white/75 px-6 pb-2 pt-7 shadow-xl backdrop-blur-xl">
          <Link
            href="/lancar"
            className={`absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-2xl p-3 shadow-2xl ring-1 transition-all ${
              launchActive ? "bg-ink text-sand scale-110 ring-ink/20" : "bg-pine text-white ring-white/60"
            }`}
            aria-label="Lançar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </Link>

          <div className="flex w-full items-end justify-center gap-7">
            {primaryLinks.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex flex-col items-center gap-1 transition-all"
                >
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-full transition-all ${
                      active
                        ? "bg-ink/10 text-ink"
                        : "text-ink/45"
                    }`}
                  >
                    {link.icon(active)}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${active ? "opacity-100" : "opacity-0"}`}>
                    {link.label}
                  </span>
                </Link>
              );
            })}

            <div className="relative flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => setMoreOpen((prev) => !prev)}
                className="flex h-10 w-10 items-center justify-center rounded-full transition-all"
                aria-label="Mais"
                aria-expanded={moreOpen}
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full transition-all ${
                    moreRouteActive || moreOpen ? "bg-ink/10 text-ink" : "text-ink/45"
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                  </svg>
                </span>
              </button>
              <span className={`text-[10px] font-bold uppercase tracking-widest ${moreRouteActive || moreOpen ? "opacity-100" : "opacity-0"}`}>
                Mais
              </span>

              {moreOpen && (
                <div className="absolute bottom-full right-1/2 z-20 mb-3 w-44 translate-x-1/2 rounded-2xl border border-ink/10 bg-white/95 p-2 shadow-2xl backdrop-blur-xl">
                  {moreLinks.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="block rounded-xl px-3 py-2 text-sm font-semibold text-ink/80 hover:bg-sand"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
