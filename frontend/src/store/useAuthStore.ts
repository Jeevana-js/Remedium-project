import { create } from "zustand";
import { persist } from "zustand/middleware";
import axios from "axios";

export interface User {
  name: string;
  email: string;
}

interface AuthStore {
  isLoggedIn: boolean;
  currentUser: User | null;
  login: (email: string, password: string) => Promise<"ok" | "invalid" | "error">;
  register: (name: string, email: string, password: string) => Promise<"ok" | "already_exists" | "error">;
  logout: () => void;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8)             return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(password))         return "Password must contain at least one uppercase letter.";
  if (!/[0-9]/.test(password))         return "Password must contain at least one number.";
  if (!/[^A-Za-z0-9]/.test(password))  return "Password must contain at least one special character.";
  return null;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      isLoggedIn: false,
      currentUser: null,

      login: async (email, password) => {
        try {
          const { data } = await axios.post("/api/auth/login", { email, password });
          set({ isLoggedIn: true, currentUser: { name: data.name, email: data.email } });
          return "ok";
        } catch (err: any) {
          if (err?.response?.status === 401) return "invalid";
          return "error";
        }
      },

      register: async (name, email, password) => {
        try {
          const { data } = await axios.post("/api/auth/register", { name, email, password });
          set({ isLoggedIn: true, currentUser: { name: data.name, email: data.email } });
          return "ok";
        } catch (err: any) {
          if (err?.response?.status === 409) return "already_exists";
          return "error";
        }
      },

      logout: () => set({ isLoggedIn: false, currentUser: null }),
    }),
    { name: "remedium-auth" }
  )
);
