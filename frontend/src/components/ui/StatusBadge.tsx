import type { CaseStatus } from "../../types";

const MAP: Record<CaseStatus, string> = {
  ingested: "badge-blue",
  analysing: "badge-amber",
  pending_approval: "badge-amber",
  approved: "badge-green",
  resolving: "badge-amber",
  resolved: "badge-green",
  escalated: "badge-red",
};

const LABEL: Record<CaseStatus, string> = {
  ingested: "Ingested",
  analysing: "Analysing…",
  pending_approval: "Awaiting Approval",
  approved: "Approved",
  resolving: "Resolving…",
  resolved: "Resolved",
  escalated: "Escalated",
};

export default function StatusBadge({ status }: { status: CaseStatus }) {
  return <span className={MAP[status]}>{LABEL[status]}</span>;
}
