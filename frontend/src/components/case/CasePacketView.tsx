import { useState } from "react";
import type { Case, CasePacket, KBArticle } from "../../types";
import ConfidenceBadge from "../ui/ConfidenceBadge";
import ReactMarkdown from "react-markdown";
import { CheckCircle, XCircle, Edit2, AlertTriangle, FlaskConical, Save, Search, RotateCcw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useToastStore } from "../../store/useToastStore";

interface Props {
  caseData: Case;
}

export default function CasePacketView({ caseData }: Props) {
  const packet = caseData.packet;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    diagnosis: "",
    resolution_steps: "",
    customer_reply: "",
  });

  const showToast = useToastStore((s) => s.show);

  const { data: allArticles = [] } = useQuery({
    queryKey: ["kb-articles"],
    queryFn: () => axios.get<KBArticle[]>("/api/kb/articles").then((r) => r.data),
  });

  const approve = useMutation({
    mutationFn: (action: "approve" | "reject" | "escalate" | "revoke") =>
      axios
        .post(`/api/cases/${caseData.id}/approve`, { action })
        .then((r) => r.data as Case),
    onSuccess: (updated, action) => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      qc.invalidateQueries({ queryKey: ["case", caseData.id] });
      if (action === "revoke") {
        showToast({
          kind: "info",
          title: "Approval revoked",
          description: "The case is back in review — approve, edit, or escalate it again.",
        });
      } else if (action === "approve") {
        const kbCount = allArticles.length;
        const parts: string[] = [`Checked against ${kbCount} KB article${kbCount === 1 ? "" : "s"}, no match found.`];
        if (updated.packet?.regression_test_snippet) parts.push("Regression test generated.");
        if (updated.status === "resolved") parts.push("A new KB article was drafted from this resolution.");
        showToast({
          kind: "success",
          title: "Case approved and resolved",
          description: parts.join(" "),
        });
      } else if (action === "reject") {
        showToast({ kind: "warning", title: "Case rejected", description: "Escalated for manual review." });
      } else if (action === "escalate") {
        showToast({ kind: "warning", title: "Case escalated", description: "Sent for manual review." });
      }
    },
    onError: () => {
      showToast({ kind: "error", title: "Action failed", description: "Could not update the case. Try again." });
    },
  });

  const saveEdit = useMutation({
    mutationFn: (edited_packet: CasePacket) =>
      axios
        .post(`/api/cases/${caseData.id}/approve`, { action: "edit", edited_packet })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      setIsEditing(false);
    },
  });

  const startEditing = () => {
    if (!packet) return;
    setEditForm({
      diagnosis: packet.diagnosis,
      resolution_steps: packet.resolution_steps.join("\n"),
      customer_reply: packet.customer_reply,
    });
    setIsEditing(true);
  };

  if (!packet) {
    return (
      <div className="card flex items-center gap-3 text-slate-400">
        <span className="animate-spin">⟳</span> Generating case packet…
      </div>
    );
  }

  const categoryLabel: Record<string, string> = {
    known_issue: "Known Issue",
    configuration: "Configuration",
    confirmed_bug: "Confirmed Bug",
    feature_gap: "Feature Gap",
    unknown: "Unknown",
  };

  const kbSource = packet.sources.find((s) => s.source_type === "kb_article");
  const bestKbMatch = packet.sources
    .filter((s) => s.source_type === "kb_article")
    .sort((a, b) => b.relevance_score - a.relevance_score)[0];
  const isAutoClosedKnownIssue = packet.category === "known_issue" && caseData.status === "resolved";

  return (
    <div className="space-y-4">
      {/* Auto-close banner */}
      {isAutoClosedKnownIssue && (
        <div className="card border-emerald-500/30 bg-emerald-500/5 flex items-start gap-3">
          <CheckCircle size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-emerald-400">
              Closed — already solved{kbSource ? ` in "${kbSource.title}"` : ""}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Automatically closed: this matches an existing knowledge base article, so no
              manual review was required.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-slate-400 mb-1">Classification</p>
            <span className="text-lg font-semibold text-white">
              {categoryLabel[packet.category]}
            </span>
          </div>
          <ConfidenceBadge score={packet.confidence} />
        </div>
      </div>

      {isEditing ? (
        <>
          <div className="card">
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Diagnosis</h3>
            <textarea
              rows={3}
              className="w-full bg-surface-3 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand-500 resize-none"
              value={editForm.diagnosis}
              onChange={(e) => setEditForm({ ...editForm, diagnosis: e.target.value })}
            />
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-slate-300 mb-2">
              Resolution Steps <span className="text-slate-500 font-normal">(one per line)</span>
            </h3>
            <textarea
              rows={5}
              className="w-full bg-surface-3 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand-500 resize-none"
              value={editForm.resolution_steps}
              onChange={(e) => setEditForm({ ...editForm, resolution_steps: e.target.value })}
            />
          </div>

          <div className="card border-brand-600/30">
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Customer Reply (Draft)</h3>
            <textarea
              rows={5}
              className="w-full bg-surface-3 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-brand-500 resize-none"
              value={editForm.customer_reply}
              onChange={(e) => setEditForm({ ...editForm, customer_reply: e.target.value })}
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() =>
                saveEdit.mutate({
                  ...packet,
                  diagnosis: editForm.diagnosis,
                  resolution_steps: editForm.resolution_steps.split("\n").map((s) => s.trim()).filter(Boolean),
                  customer_reply: editForm.customer_reply,
                })
              }
              disabled={saveEdit.isPending}
              className="btn-primary bg-emerald-600 hover:bg-emerald-700"
            >
              <Save size={14} /> {saveEdit.isPending ? "Saving…" : "Save & Approve"}
            </button>
            <button onClick={() => setIsEditing(false)} disabled={saveEdit.isPending} className="btn-ghost">
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Diagnosis */}
          <div className="card">
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Diagnosis</h3>
            <ReactMarkdown className="text-sm text-slate-300 leading-relaxed prose prose-invert prose-sm max-w-none">
              {packet.diagnosis}
            </ReactMarkdown>
          </div>

          {/* Resolution Steps */}
          <div className="card">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Resolution Steps</h3>
            <ol className="space-y-2">
              {packet.resolution_steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm text-slate-300">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-600 flex items-center justify-center text-xs text-white font-medium">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          {/* Customer Reply */}
          <div className="card border-brand-600/30">
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Customer Reply (Draft)</h3>
            <div className="bg-surface rounded-lg p-3 text-sm text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
              {packet.customer_reply}
            </div>
          </div>
        </>
      )}

      {/* Sources */}
      {packet.sources.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">
            Sources ({packet.sources.length})
          </h3>
          <div className="space-y-2">
            {packet.sources.map((s) => (
              <div
                key={s.id}
                className="flex items-start gap-3 p-2 rounded-lg bg-surface hover:bg-surface-3 transition-colors"
              >
                <span className="flex-shrink-0 text-xs badge-blue mt-0.5">
                  {s.source_type.replace("_", " ")}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{s.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{s.excerpt}</p>
                </div>
                <span className="flex-shrink-0 text-xs text-slate-500 tabular-nums">
                  {Math.round(s.relevance_score * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Regression test (auto-generated on approval for confirmed_bug) */}
      {packet.category === "confirmed_bug" && packet.regression_test_snippet && (
        <div className="card border-brand-600/30 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Regression Test Generated</h3>
            <button
              onClick={() =>
                navigate("/test-forge", {
                  state: {
                    bug_title: caseData.title,
                    bug_description: caseData.description,
                    fix_description: `${packet.diagnosis}\n\nResolution steps:\n${packet.resolution_steps
                      .map((s, i) => `${i + 1}. ${s}`)
                      .join("\n")}`,
                    case_id: caseData.id,
                  },
                })
              }
              className="btn-ghost text-xs"
            >
              <FlaskConical size={13} /> Open in TestForge
            </button>
          </div>
          <pre className="bg-surface rounded-lg p-4 text-xs text-emerald-300 font-mono overflow-auto max-h-80">
            {packet.regression_test_snippet}
          </pre>
        </div>
      )}

      {/* Approval Gate */}
      {caseData.status === "pending_approval" && !isEditing && (
        <div className="card border-amber-500/30 bg-amber-500/5">
          <h3 className="text-sm font-semibold text-amber-400 mb-2">
            Approval Gate — Review before sending
          </h3>
          <div className="flex items-start gap-2 mb-3 text-xs text-slate-400">
            <Search size={13} className="flex-shrink-0 mt-0.5" />
            <p>
              Checked against {allArticles.length} KB article{allArticles.length === 1 ? "" : "s"} —{" "}
              {bestKbMatch ? (
                <>
                  closest match was{" "}
                  <span className="text-slate-300">"{bestKbMatch.title}"</span> at{" "}
                  {Math.round(bestKbMatch.relevance_score * 100)}%, not close enough to be the same
                  issue.
                </>
              ) : (
                "no existing article covers this issue."
              )}{" "}
              Classified as a new case requiring resolution.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => approve.mutate("reject")}
              disabled={approve.isPending}
              className="btn-ghost text-red-400 hover:bg-red-500/10"
            >
              <XCircle size={14} /> Reject
            </button>
            <button
              onClick={startEditing}
              disabled={approve.isPending}
              className="btn-ghost"
            >
              <Edit2 size={14} /> Edit Draft
            </button>
            <button
              onClick={() => approve.mutate("escalate")}
              disabled={approve.isPending}
              className="btn-ghost text-amber-400"
            >
              <AlertTriangle size={14} /> Escalate
            </button>
          </div>
        </div>
      )}

      {/* Revoke — reopen an approved/resolved case for another review */}
      {(caseData.status === "approved" || caseData.status === "resolved") && !isEditing && (
        <div className="card border-slate-600/40 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400">
            This case has been {caseData.status}. Revoke to send it back to the review queue.
          </p>
          <button
            onClick={() => approve.mutate("revoke")}
            disabled={approve.isPending}
            className="btn-ghost text-amber-400 flex-shrink-0"
          >
            <RotateCcw size={14} /> {approve.isPending ? "Revoking…" : "Revoke approval"}
          </button>
        </div>
      )}
    </div>
  );
}
