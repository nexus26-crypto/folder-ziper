import { api } from "@/lib/api";

export type XtreamSource = {
  id: string; name: string; host: string; username: string;
  kind: "live" | "vod" | "series"; is_active: boolean;
  last_sync_at: string | null; created_at: string;
};

export type SyncJob = {
  id: string; job_type: string; source_id: string | null;
  status: "queued" | "running" | "success" | "failed" | "pending";
  progress: number; error: string | null;
  started_at: string | null; finished_at: string | null; created_at: string;
  payload: Record<string, unknown> | null; result: Record<string, unknown> | null;
};

export const syncApi = {
  listSources: () => api<XtreamSource[]>("/api/v1/sync/sources"),
  createSource: (body: Omit<XtreamSource, "id" | "is_active" | "last_sync_at" | "created_at"> & { password: string }) =>
    api<XtreamSource>("/api/v1/sync/sources", { method: "POST", body }),
  deleteSource: (id: string) => api<void>(`/api/v1/sync/sources/${id}`, { method: "DELETE" }),
  trigger: (source_id: string) =>
    api<SyncJob>("/api/v1/sync/trigger", { method: "POST", body: { source_id } }),
  listJobs: () => api<{ items: SyncJob[]; total: number }>("/api/v1/sync/jobs"),
};
