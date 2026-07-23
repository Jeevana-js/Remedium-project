import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Zap, RefreshCw } from "lucide-react";
import type { Case, CasePriority } from "../../types";

const CXT_COOKIE_SESSION_KEY = "remedium.cxt_session_cookie";
const CXT_RESPONSIBLE_PARTY_KEY = "remedium.cxt_responsible_party";

/**
 * AppCentral's CXT case API (GET /aurora/be/api/cxt/cases/{id}/?fieldType=extended
 * on appcentral-int.aptean.com) has been confirmed but has no service credential
 * yet — it only works behind a logged-in user's short-lived session, which isn't
 * usable for this backend. The "fetch by case ID" tab below calls
 * GET /api/appcentral/cases/{id}/preview, which 503s with a clear message until
 * APPCENTRAL_API_KEY is set (see app.connectors.appcentral_client). Paste mode
 * stays as the fallback until then.
 */

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
  defaultMode?: "paste" | "fetch" | "fetch-all";
}) {
  const [mode, setMode] = useState<"paste" | "fetch" | "fetch-all">(defaultMode);
  const [raw, setRaw] = useState("");
  const [caseId, setCaseId] = useState("");
  const [sessionCookie, setSessionCookie] = useState(
    () => sessionStorage.getItem(CXT_COOKIE_SESSION_KEY) ?? ""
  );
  const [responsibleParty, setResponsibleParty] = useState(
    () => sessionStorage.getItem(CXT_RESPONSIBLE_PARTY_KEY) ?? ""
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

  const fetchAllMutation = useMutation({
    mutationFn: () => {
      sessionStorage.setItem(CXT_COOKIE_SESSION_KEY, sessionCookie.trim());
      sessionStorage.setItem(CXT_RESPONSIBLE_PARTY_KEY, responsibleParty.trim());
      return axios
        .post<FetchNewResult>("/api/appcentral/fetch-new", {
          cookie: sessionCookie.trim(),
          responsible_party: responsibleParty.split(",").map((s) => s.trim()).filter(Boolean),
        })
        .then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases"] });
    },
  });

  const fetchAllError = fetchAllMutation.isError
    ? axios.isAxiosError(fetchAllMutation.error) && fetchAllMutation.error.response?.status === 401
      ? "Session cookie was rejected — it's likely expired (~30 min lifetime). Capture a fresh one from DevTools and try again."
      : "Failed to fetch tickets from AppCentral."
    : null;

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Zap size={15} className="text-brand-400" />
          Fetch AppCentral Ticket
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Import a CXT case from{" "}
          <span className="text-slate-400">appcentral-int.aptean.com</span> by case number, or
          paste one manually below.
        </p>
      </div>

      <div className="flex gap-1 bg-surface-2 rounded-lg p-1 text-xs w-fit">
        <button
          type="button"
          className={`px-3 py-1 rounded-md ${mode === "fetch-all" ? "bg-surface-3 text-slate-100" : "text-slate-500"}`}
          onClick={() => setMode("fetch-all")}
        >
          Fetch all new
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

      {mode === "fetch-all" ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            fetchAllMutation.mutate();
          }}
        >
          <div className="bg-surface-2 rounded-lg px-3 py-2.5 text-xs text-slate-400 border border-surface-3">
            CXT sessions expire after ~30 minutes. If this fails with a 401, open AppCentral in
            your browser, DevTools → Network → any <code>/cxt/...</code> request → Request
            Headers → copy the full <code>cookie</code> value and paste it below. Stored only in
            this browser tab (sessionStorage) — never sent anywhere except this request, never
            saved to disk.
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">Session cookie</label>
            <textarea
              required
              rows={3}
              className="w-full bg-surface-3 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 resize-none font-mono"
              value={sessionCookie}
              onChange={(e) => setSessionCookie(e.target.value)}
              placeholder="AUT_SESSION_ID=...; X_APTEAN_TOKEN=...; sessionid=...; csrftoken=..."
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Responsible party ID(s) <span className="text-slate-600">(comma-separated)</span>
            </label>
            <input
              required
              className="w-full bg-surface-3 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 font-mono"
              value={responsibleParty}
              onChange={(e) => setResponsibleParty(e.target.value)}
              placeholder="0033i00002AZJZcAAP"
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            {fetchAllError && <span className="text-xs text-red-400">{fetchAllError}</span>}
            {fetchAllMutation.data && (
              <span className="text-xs text-emerald-400">
                Fetched {fetchAllMutation.data.fetched}, imported {fetchAllMutation.data.created} new
                {fetchAllMutation.data.skipped_existing > 0 &&
                  ` (${fetchAllMutation.data.skipped_existing} already existed)`}
                .
              </span>
            )}
            <div className="ml-auto">
              <button
                type="submit"
                disabled={fetchAllMutation.isPending || !sessionCookie.trim() || !responsibleParty.trim()}
                className="btn-primary"
              >
                <RefreshCw size={14} className={fetchAllMutation.isPending ? "animate-spin" : ""} />
                {fetchAllMutation.isPending ? "Fetching…" : "Fetch All New Tickets"}
              </button>
            </div>
          </div>
        </form>
      ) : mode === "fetch" ? (
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
