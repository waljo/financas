import { Navigate, Route, Routes } from "react-router-dom";
import { AppNav } from "./components/AppNav";
import CartoesPage from "./pages/CartoesPage";
import { DashboardPage } from "./pages/DashboardPage";
import LancarPage from "./pages/LancarPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";

export default function App() {
  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-32">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/cartoes" element={<CartoesPage />} />
          <Route path="/lancar" element={<LancarPage />} />
          <Route path="/categorias" element={<PlaceholderPage title="Categorias" />} />
          <Route path="/importar" element={<PlaceholderPage title="Importar" />} />
          <Route path="/contas-fixas" element={<PlaceholderPage title="Contas fixas" />} />
          <Route path="/relatorios" element={<PlaceholderPage title="Relatorios" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
