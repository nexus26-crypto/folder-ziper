/**
 * Store de autenticação. Persistido em localStorage.
 * Fonte única de verdade para tokens + usuário atual no frontend.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type CurrentUser = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  tenant_id: string | null;
  tenant_slug: string | null;
  tenant_name: string | null;
  created_at: string;
};

type AuthState = {
  user: CurrentUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (user: CurrentUser, access: string, refresh: string) => void;
  setUser: (user: CurrentUser) => void;
  setTokens: (access: string, refresh: string) => void;
  logout: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, access, refresh) =>
        set({ user, accessToken: access, refreshToken: refresh }),
      setUser: (user) => set({ user }),
      setTokens: (access, refresh) => set({ accessToken: access, refreshToken: refresh }),
      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    {
      name: "vyntrix-auth",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? localStorage : ({
        getItem: () => null, setItem: () => {}, removeItem: () => {},
      } as any))),
    },
  ),
);

export function isAuthenticated(): boolean {
  const s = useAuthStore.getState();
  return !!(s.accessToken && s.user);
}
