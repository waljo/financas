"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/lancar", label: "Lancar" },
  { href: "/cartoes", label: "Cartoes" },
  { href: "/categorias", label: "Categorias" },
  { href: "/contas-fixas", label: "Contas Fixas" },
  { href: "/calendario-anual", label: "Calendario" },
  { href: "/relatorios", label: "Relatorios" },
  { href: "/importar", label: "Importar" }
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-10 border-b border-ink/15 bg-sand/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={[
                "rounded-full px-4 py-2 text-sm font-medium transition",
                active
                  ? "bg-ink text-sand"
                  : "bg-white text-ink hover:bg-mint hover:text-ink"
              ].join(" ")}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
