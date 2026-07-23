import { create } from "zustand";
import { persist } from "zustand/middleware";
import axios from "axios";

interface AdoConnectionInfo {
  sessionId: string;
  organization: string;
  project: string;
  team: string;
}

interface AdoStore {
  connection: AdoConnectionInfo | null;
  connecting: boolean;
  connect: (
    userEmail: string,
    organization: string,
    project: string,
    team: string,
    pat: string
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  disconnect: () => Promise<void>;
  /** Re-check the saved connection for this user (survives backend restarts). */
  restore: (userEmail: string) => Promise<void>;
}

export const useAdoStore = create<AdoStore>()(
  persist(
    (set, get) => ({
      connection: null,
      connecting: false,

      connect: async (userEmail, organization, project, team, pat) => {
        set({ connecting: true });
        try {
          const { data } = await axios.post("/api/ado/connect", {
            user_email: userEmail,
            organization,
            project,
            team,
            pat,
          });
          set({
            connection: {
              sessionId: data.session_id,
              organization: data.organization,
              project: data.project,
              team: data.team,
            },
          });
          return { ok: true };
        } catch (err: any) {
          return {
            ok: false,
            message:
              err?.response?.data?.detail ??
              "Could not connect. Check the organization URL, project, team, and PAT.",
          };
        } finally {
          set({ connecting: false });
        }
      },

      disconnect: async () => {
        const sessionId = get().connection?.sessionId;
        set({ connection: null });
        if (sessionId) {
          try {
            await axios.post("/api/ado/disconnect", null, {
              headers: { "X-Ado-Session": sessionId },
            });
          } catch {
            // best-effort — session will simply be dropped client-side
          }
        }
      },

      restore: async (userEmail) => {
        try {
          const { data } = await axios.get(
            `/api/ado/connection/${encodeURIComponent(userEmail)}`
          );
          if (data.connected) {
            set({
              connection: {
                sessionId: data.session_id,
                organization: data.organization,
                project: data.project,
                team: data.team,
              },
            });
          } else {
            set({ connection: null });
          }
        } catch {
          // backend unreachable — keep whatever was last persisted client-side
        }
      },
    }),
    { name: "remedium-ado" }
  )
);

// Attach the active ADO session to every request so the backend targets the
// user's connected board instead of the .env default.
axios.interceptors.request.use((config) => {
  const sessionId = useAdoStore.getState().connection?.sessionId;
  if (sessionId && config.url?.includes("/api/ado")) {
    config.headers = config.headers ?? {};
    config.headers["X-Ado-Session"] = sessionId;
  }
  return config;
});
