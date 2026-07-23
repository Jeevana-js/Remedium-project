import { create } from "zustand";
import type { Case } from "../types";

interface CaseStore {
  cases: Case[];
  activeCaseId: string | null;
  setCases: (cases: Case[]) => void;
  upsertCase: (c: Case) => void;
  setActive: (id: string | null) => void;
}

export const useCaseStore = create<CaseStore>((set) => ({
  cases: [],
  activeCaseId: null,
  setCases: (cases) => set({ cases }),
  upsertCase: (c) =>
    set((s) => {
      const idx = s.cases.findIndex((x) => x.id === c.id);
      if (idx === -1) return { cases: [...s.cases, c] };
      const next = [...s.cases];
      next[idx] = c;
      return { cases: next };
    }),
  setActive: (id) => set({ activeCaseId: id }),
}));
