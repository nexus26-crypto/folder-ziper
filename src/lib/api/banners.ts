import { api } from "@/lib/api";

export type Banner = {
  id: string; title: string; subtitle: string | null;
  theme: "dark" | "light" | "custom"; template: string;
  logo_url: string | null; image_url: string | null;
  status: string; created_at: string;
};

export const bannersApi = {
  list: () => api<{ items: Banner[]; total: number }>("/api/v1/banners"),
  create: (body: { title: string; subtitle?: string; theme?: string; template?: string; logo_url?: string }) =>
    api<Banner>("/api/v1/banners", { method: "POST", body }),
  remove: (id: string) => api<void>(`/api/v1/banners/${id}`, { method: "DELETE" }),
};
