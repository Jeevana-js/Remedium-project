import { useEffect, useState } from "react";
import { GitBranch, CheckCircle2, XCircle, Link2, Unlink } from "lucide-react";
import { useAdoStore } from "../store/useAdoStore";
import { useAuthStore } from "../store/useAuthStore";

export default function AdoConnectionPage() {
  const { connection, connecting, connect, disconnect, restore } = useAdoStore();
  const currentUser = useAuthStore((s) => s.currentUser);

  const [organization, setOrganization] = useState("https://dev.azure.com/YourOrg");
  const [project, setProject] = useState("");
  const [team, setTeam] = useState("");
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (currentUser?.email) restore(currentUser.email);
  }, [currentUser?.email]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!currentUser?.email) {
      setError("You must be signed in to connect a board.");
      return;
    }
    const result = await connect(
      currentUser.email,
      organization.trim(),
      project.trim(),
      team.trim(),
      pat.trim()
    );
    if (!result.ok) setError(result.message);
  };

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitBranch size={22} className="text-brand-500" /> Azure DevOps Connection
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Connect any Azure DevOps organization with a personal access token. Work items,
          backlog, and BridgeOps dedup will target this board.
        </p>
      </div>

      {connection ? (
        <div className="card space-y-4">
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 size={18} />
            <span className="text-sm font-medium">Connected</span>
          </div>
          <dl className="text-sm space-y-1.5">
            <div className="flex gap-2">
              <dt className="text-slate-500 w-24 flex-shrink-0">Organization</dt>
              <dd className="text-slate-200 truncate">{connection.organization}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-slate-500 w-24 flex-shrink-0">Project</dt>
              <dd className="text-slate-200">{connection.project}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-slate-500 w-24 flex-shrink-0">Team</dt>
              <dd className="text-slate-200">{connection.team}</dd>
            </div>
          </dl>
          <button onClick={() => disconnect()} className="btn-ghost text-red-400 hover:text-red-300">
            <Unlink size={14} /> Disconnect
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="card space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Organization URL
            </label>
            <input
              className="w-full bg-surface-3 border border-surface-3 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="https://dev.azure.com/YourOrg"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Project
            </label>
            <input
              className="w-full bg-surface-3 border border-surface-3 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="My Project"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Team
            </label>
            <input
              className="w-full bg-surface-3 border border-surface-3 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="My Project Team"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Personal Access Token
            </label>
            <div className="relative">
              <input
                type={showPat ? "text" : "password"}
                className="w-full bg-surface-3 border border-surface-3 rounded-lg px-3 py-2.5 pr-16 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder="Paste your ADO PAT"
                required
              />
              <button
                type="button"
                onClick={() => setShowPat((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300"
              >
                {showPat ? "Hide" : "Show"}
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Needs Work Items (Read &amp; Write) and Code (Read) scopes. Stored encrypted on the
              server, tied to your account — reconnecting isn't needed after a restart.
            </p>
          </div>

          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <XCircle size={13} /> {error}
            </p>
          )}

          <button
            type="submit"
            disabled={connecting || !organization.trim() || !project.trim() || !team.trim() || !pat.trim()}
            className="w-full btn-primary py-2.5 text-sm font-medium justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Link2 size={14} />
            {connecting ? "Connecting…" : "Connect"}
          </button>
        </form>
      )}
    </div>
  );
}
