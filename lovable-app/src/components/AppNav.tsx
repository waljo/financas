import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

const primaryLinks = [
  { to: "/", label: "Inicio" },
  { to: "/cartoes", label: "Cartoes" }
];

const moreLinks = [
  { to: "/relatorios", label: "Relatorios" },
  { to: "/categorias", label: "Categorias" },
  { to: "/importar", label: "Importar" },
  { to: "/contas-fixas", label: "Contas fixas" }
];

export function AppNav() {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const launchActive = location.pathname === "/lancar";

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  return (
    <>
      <nav className="sticky top-0 z-40 h-14 border-b border-ink/5 bg-sand/80 px-6 backdrop-blur-md">
        <div className="flex h-full items-center">
          <span className="text-sm font-black uppercase tracking-widest text-ink/40">FinancasG</span>
        </div>
      </nav>

      {moreOpen ? (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMoreOpen(false)}
          className="fixed inset-0 z-[45] cursor-default bg-transparent"
        />
      ) : null}

      <nav className="fixed bottom-0 left-0 z-50 w-full pb-2">
        <div className="relative flex w-full flex-col items-center border-t border-ink/10 bg-white/75 px-6 pb-2 pt-7 shadow-xl backdrop-blur-xl">
          <Link
            to="/lancar"
            className={`absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-2xl p-3 shadow-2xl ring-1 transition-all ${
              launchActive ? "scale-110 bg-ink text-sand ring-ink/20" : "bg-pine text-white ring-white/60"
            }`}
            aria-label="Lancar"
          >
            +
          </Link>

          <div className="flex w-full items-end justify-center gap-7">
            {primaryLinks.map((item) => (
              <NavLink key={item.to} to={item.to} className="flex flex-col items-center gap-1 transition-all">
                {({ isActive }) => (
                  <>
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-black uppercase transition-all ${
                        isActive ? "bg-ink/10 text-ink" : "text-ink/45"
                      }`}
                    >
                      {item.label.slice(0, 2)}
                    </span>
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${isActive ? "opacity-100" : "opacity-0"}`}>
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            ))}

            <div className="relative flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => setMoreOpen((prev) => !prev)}
                className="flex h-10 w-10 items-center justify-center rounded-full transition-all"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full text-ink/45">|||</span>
              </button>
              <span className="text-[10px] font-bold uppercase tracking-widest">Mais</span>

              {moreOpen && (
                <div className="absolute bottom-full right-1/2 z-20 mb-3 w-44 translate-x-1/2 rounded-2xl border border-ink/10 bg-white/95 p-2 shadow-2xl backdrop-blur-xl">
                  {moreLinks.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className="block rounded-xl px-3 py-2 text-sm font-semibold text-ink/80 hover:bg-sand"
                    >
                      {item.label}
                    </NavLink>
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
