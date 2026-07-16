import { api } from "@/lib/api";

export type Member = {
  id: string; email: string; full_name: string;
  role: "owner" | "admin" | "staff"; is_active: boolean; created_at: string;
};

export const membersApi = {
  list: () => api<{ items: Member[]; total: number }>("/api/v1/members"),
  invite: (body: { email: string; full_name: string; role: "admin" | "staff"; password: string }) =>
    api<Member>("/api/v1/members", { method: "POST", body }),
  update: (id: string, body: Partial<{ role: "admin" | "staff"; is_active: boolean; full_name: string }>) =>
    api<Member>(`/api/v1/members/${id}`, { method: "PATCH", body }),
  remove: (id: string) => api<void>(`/api/v1/members/${id}`, { method: "DELETE" }),
};
