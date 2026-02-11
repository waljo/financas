import { Navigate, Route, Routes } from "react-router-dom";
import { AppNav } from "./components/AppNav";
import CategoriasPage from "./pages/CategoriasPage";
import CartoesPage from "./pages/CartoesPage";
import ContasFixasPage from "./pages/ContasFixasPage";
import { DashboardPage } from "./pages/DashboardPage";
import ImportarPage from "./pages/ImportarPage";
import LancarPage from "./pages/LancarPage";
import RelatoriosPage from "./pages/RelatoriosPage";

export default function App() {
  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-32">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/cartoes" element={<CartoesPage />} />
          <Route path="/lancar" element={<LancarPage />} />
          <Route path="/categorias" element={<CategoriasPage />} />
          <Route path="/importar" element={<ImportarPage />} />
          <Route path="/contas-fixas" element={<ContasFixasPage />} />
          <Route path="/relatorios" element={<RelatoriosPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
