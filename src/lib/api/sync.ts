import { api } from "@/lib/api";

export type SourceType = "m3u_url" | "m3u_file" | "xtream_api";

export type XtreamSource = {
  id: string;
  name: string;
  source_type: SourceType;
  host: string | null;
  username: string | null;
  kind: string;
  m3u_url: string | null;
  xui_connection_id: string | null;
  mapping: Record<string, any> | null;
  auto_sync: boolean;
  auto_sync_cron: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  last_auto_run_at: string | null;
  created_at: string;
};

export type SyncJob = {
  id: string;
  job_type: string;
  source_id: string | null;
  status: "queued" | "running" | "success" | "failed" | "pending";
  progress: number;
  total_items: number;
  inserted: number;
  skipped: number;
  errors: number;
  log_tail: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
};

export type CreateSourceBody = {
  name: string;
  source_type: SourceType;
  host?: string | null;
  username?: string | null;
  password?: string | null;
  kind?: string;
  m3u_url?: string | null;
  m3u_content?: string | null;
  xui_connection_id?: string | null;
  mapping?: Record<string, any> | null;
  auto_sync?: boolean;
  auto_sync_cron?: string | null;
};

export const syncApi = {
  listSources: () => api<XtreamSource[]>("/api/v1/sync/sources"),
  createSource: (body: CreateSourceBody) =>
    api<XtreamSource>("/api/v1/sync/sources", { method: "POST", body }),
  updateSource: (id: string, body: Partial<CreateSourceBody> & { is_active?: boolean }) =>
    api<XtreamSource>(`/api/v1/sync/sources/${id}`, { method: "PATCH", body }),
  deleteSource: (id: string) => api<void>(`/api/v1/sync/sources/${id}`, { method: "DELETE" }),
  uploadM3u: async (name: string, file: File, xui_connection_id?: string) => {
    const fd = new FormData();
    fd.append("name", name);
    fd.append("file", file);
    if (xui_connection_id) fd.append("xui_connection_id", xui_connection_id);
    return api<XtreamSource>("/api/v1/sync/sources/upload-m3u", { method: "POST", body: fd });
  },
  trigger: (source_id: string) =>
    api<SyncJob>("/api/v1/sync/trigger", { method: "POST", body: { source_id } }),
  listJobs: (limit = 50) =>
    api<{ items: SyncJob[]; total: number }>(`/api/v1/sync/jobs?limit=${limit}`),
  getJob: (id: string) => api<SyncJob>(`/api/v1/sync/jobs/${id}`),
  getJobLog: (id: string) => api<{ log: string; status: string; progress: number }>(`/api/v1/sync/jobs/${id}/log`),
};
