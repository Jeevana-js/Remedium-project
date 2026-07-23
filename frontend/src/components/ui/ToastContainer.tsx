import { CheckCircle, Info, AlertTriangle, XCircle, X } from "lucide-react";
import { useToastStore, type ToastKind } from "../../store/useToastStore";

const ICON: Record<ToastKind, typeof CheckCircle> = {
  success: CheckCircle,
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
};

const COLOR: Record<ToastKind, string> = {
  success: "border-emerald-500/30 text-emerald-400",
  info: "border-brand-600/30 text-brand-400",
  warning: "border-amber-500/30 text-amber-400",
  error: "border-red-500/30 text-red-400",
};

export default function ToastContainer() {
  const { toasts, dismiss } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div
            key={t.id}
            className={`card ${COLOR[t.kind]} flex items-start gap-3 shadow-lg`}
          >
            <Icon size={18} className="flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-100">{t.title}</p>
              {t.description && (
                <p className="text-xs text-slate-400 mt-0.5">{t.description}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-slate-500 hover:text-slate-300 flex-shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
