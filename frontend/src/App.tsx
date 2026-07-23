import { Routes, Route } from "react-router-dom";
import Shell from "./components/ui/Shell";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CasesPage from "./pages/CasesPage";
import CaseDetailPage from "./pages/CaseDetailPage";
import TestForgePage from "./pages/TestForgePage";
import LiveKBPage from "./pages/LiveKBPage";
import KBArticleDetailPage from "./pages/KBArticleDetailPage";
import AdoConnectionPage from "./pages/AdoConnectionPage";
import { useAuthStore } from "./store/useAuthStore";

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  if (!isLoggedIn) return <LoginPage />;

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/cases" element={<CasesPage />} />
        <Route path="/cases/:id" element={<CaseDetailPage />} />
        <Route path="/test-forge" element={<TestForgePage />} />
        <Route path="/live-kb" element={<LiveKBPage />} />
        <Route path="/live-kb/:id" element={<KBArticleDetailPage />} />
        <Route path="/ado-connection" element={<AdoConnectionPage />} />
      </Routes>
    </Shell>
  );
}
