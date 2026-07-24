import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Zap, RefreshCw, ChevronDown } from "lucide-react";
import type { Case, CasePriority } from "../../types";

const CXT_COOKIE_SESSION_KEY = "remedium.cxt_session_cookie";

interface ParsedTicket {
  ticketId: string;
  title: string;
  description: string;
  priority: CasePriority;
}

const PRIORITY_MAP: Record<string, CasePriority> = {
  p1: "critical", critical: "critical", urgent: "critical",
  p2: "high", high: "high",
  p3: "medium", medium: "medium", normal: "medium",
  p4: "low", low: "low",
};

function parseTicketText(raw: string): ParsedTicket {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  let ticketId = "";
  let title = "";
  let priority: CasePriority = "medium";
  const bodyLines: string[] = [];

  const idMatch = raw.match(/\b(CXT-\d+|#\d{3,})\b/i);
  if (idMatch) ticketId = idMatch[1].toUpperCase();

  for (const line of lines) {
    const kv = line.match(/^(ticket\s*id|id|title|subject|summary|priority)\s*[:\-]\s*(.+)$/i);
    if (kv) {
      const key = kv[1].toLowerCase();
      const value = kv[2].trim();
      if (key.includes("id")) ticketId = ticketId || value;
      else if (key === "title" || key === "subject" || key === "summary") title = title || value;
      else if (key === "priority") priority = PRIORITY_MAP[value.toLowerCase()] ?? "medium";
      continue;
    }
    bodyLines.push(line);
  }

  if (!title) title = bodyLines[0] ?? "Untitled AppCentral ticket";
  const description = bodyLines.slice(title === bodyLines[0] ? 1 : 0).join("\n") || raw;

  return { ticketId, title, description, priority };
}

interface AppCentralCasePreview {
  title: string;
  description: string;
  customer?: string;
  product?: string;
  priority: CasePriority;
  external_id?: string;
}

interface FetchNewResult {
  fetched: number;
  created: number;
  skipped_existing: number;
  created_cases: Case[];
}

export default function AppCentralTicketForm({
  onCreated,
  defaultMode = "paste",
}: {
  onCreated?: (c: Case) => void;
  defaultMode?: "paste" | "fetch" | "sync";
}) {
  const [mode, setMode] = useState<"paste" | "fetch" | "sync">(defaultMode);
  const [showOtherOptions, setShowOtherOptions] = useState(defaultMode !== "sync");
  const [raw, setRaw] = useState("");
  const [caseId, setCaseId] = useState("");
  const [sessionCookie, setSessionCookie] = useState(
    () => sessionStorage.getItem(CXT_COOKIE_SESSION_KEY) ?? ""
  );
  const qc = useQueryClient();

  const preview = raw.trim() ? parseTicketText(raw) : null;

  const pasteMutation = useMutation({
    mutationFn: () => {
      const parsed = parseTicketText(raw);
      return axios
        .post<Case>("/api/cases/", {
          title: parsed.title,
          description: parsed.description,
          priority: parsed.priority,
          product: "CXT",
          external_id: parsed.ticketId || undefined,
        })
        .then((r) => r.data);
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      setRaw("");
      onCreated?.(c);
    },
  });

  const fetchMutation = useMutation({
    mutationFn: async () => {
      const { data: parsed } = await axios.get<AppCentralCasePreview>(
        `/api/appcentral/cases/${encodeURIComponent(caseId.trim())}/preview`
      );
      const { data: created } = await axios.post<Case>("/api/cases/", parsed);
      return created;
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      setCaseId("");
      onCreated?.(c);
    },
  });

  const fetchError = fetchMutation.isError
    ? axios.isAxiosError(fetchMutation.error) && fetchMutation.error.response?.status === 503
      ? "AppCentral API isn't connected yet — no service credential configured. Use paste mode for now."
      : "Failed to fetch case from AppCentral."
    : null;

  const syncMutation = useMutation({
    mutationFn: () => {
      sessionStorage.setItem(CXT_COOKIE_SESSION_KEY, sessionCookie.trim());
      return axios
        .post<FetchNewResult>("/api/appcentral/sync", { cookie: sessionCookie.trim() })
        .then((r) => r.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cases"] }),
  });

  const syncError = syncMutation.isError
    ? axios.isAxiosError(syncMutation.error) && syncMutation.error.response?.status === 503
      ? "Sync webhook isn't configured — set APPCENTRAL_SYNC_WEBHOOK_URL in .env."
      : axios.isAxiosError(syncMutation.error) && syncMutation.error.response?.status === 401
      ? "Cookie expired — paste a fresh one from DevTools."
      : "Failed to fetch tickets from AppCentral."
    : null;

  if (mode === "sync") {
    return (
      <div className="card space-y-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            syncMutation.mutate();
          }}
        >
          <div className="flex-1">
            <label className="text-xs text-slate-400 mb-1 block">
              AppCentral session cookie{" "}
              <span className="text-slate-600">(expires ~30 min — DevTools → Network → cookie)</span>
            </label>
            <input
              required
              className="w-full bg-surface-3 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 font-mono"
              value={sessionCookie}
              onChange={(e) => setSessionCookie(e.target.value)}
              placeholder="AUT_SESSION_ID=...; X_APTEAN_TOKEN=...; sessionid=...; csrftoken=..."
            />
          </div>
          <button
            type="submit"
            disabled={syncMutation.isPending || !sessionCookie.trim()}
            className="btn-primary flex-shrink-0"
          >
            <RefreshCw size={14} className={syncMutation.isPending ? "animate-spin" : ""} />
            {syncMutation.isPending ? "Fetching…" : "Fetch"}
          </button>
        </form>

        {syncError && <p className="text-xs text-red-400">{syncError}</p>}
        {syncMutation.data && !syncError && (
          <p className="text-xs text-emerald-400">
            {syncMutation.data.created === 0
              ? `No new tickets — checked ${syncMutation.data.fetched}, all already in Remedium.`
              : `Fetched ${syncMutation.data.fetched}, imported ${syncMutation.data.created} new` +
                (syncMutation.data.skipped_existing > 0
                  ? ` (${syncMutation.data.skipped_existing} already existed).`
                  : ".")}
          </p>
        )}

        <button
          type="button"
          onClick={() => setShowOtherOptions((s) => !s)}
          className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"
        >
          <ChevronDown size={12} className={showOtherOptions ? "rotate-180" : ""} />
          Other ways to add a ticket
        </button>

        {showOtherOptions && (
          <div className="flex gap-1 bg-surface-2 rounded-lg p-1 text-xs w-fit">
            <button
              type="button"
              className="px-3 py-1 rounded-md text-slate-500 hover:text-slate-300"
              onClick={() => setMode("fetch")}
            >
              Fetch by case ID
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded-md text-slate-500 hover:text-slate-300"
              onClick={() => setMode("paste")}
            >
              Paste ticket
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div className="flex gap-1 bg-surface-2 rounded-lg p-1 text-xs w-fit">
        <button
          type="button"
          className="px-3 py-1 rounded-md text-slate-500 hover:text-slate-300"
          onClick={() => setMode("sync")}
        >
          ← Fetch all new
        </button>
        <button
          type="button"
          className={`px-3 py-1 rounded-md ${mode === "fetch" ? "bg-surface-3 text-slate-100" : "text-slate-500"}`}
          onClick={() => setMode("fetch")}
        >
          Fetch by case ID
        </button>
        <button
          type="button"
          className={`px-3 py-1 rounded-md ${mode === "paste" ? "bg-surface-3 text-slate-100" : "text-slate-500"}`}
          onClick={() => setMode("paste")}
        >
          Paste ticket
        </button>
      </div>

      {mode === "fetch" ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            fetchMutation.mutate();
          }}
        >
          <input
            required
            className="w-full bg-surface-3 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 font-mono"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            placeholder="Case number or ID, e.g. 06190434 or 500a7000010LHlQAAW"
          />

          <div className="flex items-center justify-between pt-1">
            {fetchError && <span className="text-xs text-red-400">{fetchError}</span>}
            <div className="ml-auto">
              <button
                type="submit"
                disabled={fetchMutation.isPending || !caseId.trim()}
                className="btn-primary"
              >
                <Zap size={14} />
                {fetchMutation.isPending ? "Fetching…" : "Fetch & Resolve"}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            pasteMutation.mutate();
          }}
        >
          <textarea
            required
            rows={9}
            className="w-full bg-surface-3 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 resize-none font-mono"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={
              "Ticket ID: CXT-4821\n" +
              "Title: Invoice export fails for multi-currency orders\n" +
              "Priority: High\n\n" +
              "Customer reports that exporting invoices to PDF fails with a 500 error\n" +
              "whenever the order contains line items in more than one currency…"
            }
          />

          {preview && (
            <div className="bg-surface-2 rounded-lg px-3 py-2.5 text-xs space-y-1 border border-surface-3">
              <p className="text-slate-500">Parsed preview</p>
              <p>
                <span className="text-slate-500">Ticket:</span>{" "}
                <span className="text-slate-200">{preview.ticketId || "— (no ID detected)"}</span>
              </p>
              <p>
                <span className="text-slate-500">Title:</span>{" "}
                <span className="text-slate-200">{preview.title}</span>
              </p>
              <p>
                <span className="text-slate-500">Priority:</span>{" "}
                <span className="text-slate-200">{preview.priority}</span>
              </p>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            {pasteMutation.isError && (
              <span className="text-xs text-red-400">Failed to ingest. Check API connection.</span>
            )}
            <div className="ml-auto">
              <button
                type="submit"
                disabled={pasteMutation.isPending || !raw.trim()}
                className="btn-primary"
              >
                <Zap size={14} />
                {pasteMutation.isPending ? "Resolving…" : "Resolve Ticket"}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
