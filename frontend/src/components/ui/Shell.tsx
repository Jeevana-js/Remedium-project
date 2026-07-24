import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Inbox,
  FlaskConical,
  BookOpen,
  Plug,
  LogOut,
} from "lucide-react";
import { clsx } from "clsx";
import { useAuthStore } from "../../store/useAuthStore";
import { useAdoStore } from "../../store/useAdoStore";
import ToastContainer from "./ToastContainer";

const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/cases", icon: Inbox, label: "Resolve" },
  { to: "/test-forge", icon: FlaskConical, label: "TestForge" },
  { to: "/live-kb", icon: BookOpen, label: "LiveKB" },
  { to: "/ado-connection", icon: Plug, label: "ADO Connection" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const { currentUser, logout } = useAuthStore();
  const adoConnection = useAdoStore((s) => s.connection);
  const restoreAdo = useAdoStore((s) => s.restore);

  useEffect(() => {
    if (currentUser?.email) restoreAdo(currentUser.email);
  }, [currentUser?.email]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <nav className="w-56 flex-shrink-0 bg-surface-2 border-r border-surface-3 flex flex-col">
        <div className="px-5 py-6">
          <span className="text-xl font-bold text-white tracking-tight">
            Remedium
            <span className="text-brand-500">.</span>
          </span>
          <p className="text-xs text-slate-500 mt-0.5">Support Intelligence</p>
        </div>
        <ul className="flex-1 space-y-0.5 px-2">
          {NAV.map(({ to, icon: Icon, label }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                    isActive
                      ? "bg-brand-600 text-white"
                      : "text-slate-400 hover:bg-surface-3 hover:text-slate-100"
                  )
                }
              >
                <Icon size={16} />
                <span className="flex-1">{label}</span>
                {to === "/ado-connection" && (
                  <span
                    className={clsx(
                      "w-1.5 h-1.5 rounded-full flex-shrink-0",
                      adoConnection ? "bg-emerald-400" : "bg-slate-600"
                    )}
                    title={adoConnection ? "Connected" : "Not connected"}
                  />
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="px-4 py-4 border-t border-surface-3 space-y-2">
          <div className="flex items-center gap-2.5 px-1">
            <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
              {currentUser?.name?.charAt(0).toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-300 truncate">{currentUser?.name}</p>
              <p className="text-xs text-slate-600 truncate">{currentUser?.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-slate-500 hover:bg-surface-3 hover:text-slate-300 transition-colors"
          >
            <LogOut size={13} />
            Sign out
          </button>
          <p className="text-xs text-slate-700 px-1">v0.1.0 · Aptean</p>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto bg-surface p-6">{children}</main>

      <ToastContainer />
    </div>
  );
}
