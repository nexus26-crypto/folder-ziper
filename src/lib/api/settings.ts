import { api } from "@/lib/api";
import type { CurrentUser } from "@/lib/auth-store";

export type Workspace = {
  id: string; slug: string; name: string;
  plan: string; status: string; created_at: string;
};

export const settingsApi = {
  updateProfile: (body: { full_name?: string; current_password?: string; new_password?: string }) =>
    api<CurrentUser>("/api/v1/settings/profile", { method: "PATCH", body }),
  getWorkspace: () => api<Workspace>("/api/v1/settings/workspace"),
  updateWorkspace: (body: { name: string }) =>
    api<Workspace>("/api/v1/settings/workspace", { method: "PATCH", body }),
};
