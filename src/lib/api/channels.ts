import { api } from "@/lib/api";

export type Channel = {
  id: string;
  name: string;
  category: string | null;
  group_name: string | null;
  logo_url: string | null;
  stream_url: string | null;
  epg_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ChannelInput = Partial<Omit<Channel, "id" | "created_at" | "updated_at">> & { name: string };

export const channelsApi = {
  list: (params: { q?: string; category?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.category) qs.set("category", params.category);
    qs.set("limit", String(params.limit ?? 100));
    qs.set("offset", String(params.offset ?? 0));
    return api<{ items: Channel[]; total: number }>(`/api/v1/channels?${qs}`);
  },
  create: (body: ChannelInput) => api<Channel>("/api/v1/channels", { method: "POST", body }),
  update: (id: string, body: Partial<ChannelInput>) =>
    api<Channel>(`/api/v1/channels/${id}`, { method: "PATCH", body }),
  remove: (id: string) => api<void>(`/api/v1/channels/${id}`, { method: "DELETE" }),
  bulk: (ids: string[], action: "activate" | "deactivate" | "delete") =>
    api<void>("/api/v1/channels/bulk", { method: "POST", body: { ids, action } }),
};
