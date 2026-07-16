import { api } from "@/lib/api";

export type XuiConnection = {
  id: string;
  name: string;
  host: string;
  port: number;
  db_name: string;
  db_user: string;
  is_default: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  detected_version: string | null;
  created_at: string;
};

export type XuiMeta = {
  ok: boolean;
  version: string;
  servers: { id: number; nome: string }[];
  bouquets: { id: number; nome: string }[];
  categories: {
    live: { id: number; nome: string }[];
    movie: { id: number; nome: string }[];
    series: { id: number; nome: string }[];
  };
};

export type XuiTest = {
  ok: boolean;
  version?: string | null;
  error?: string | null;
  servers?: { id: number; nome: string }[];
  bouquets?: { id: number; nome: string }[];
  categories?: XuiMeta["categories"];
};

export const xuiApi = {
  list: () => api<XuiConnection[]>("/api/v1/xui-connections"),
  create: (body: {
    name: string; host: string; port: number;
    db_name: string; db_user: string; db_pass: string;
    is_default?: boolean;
  }) => api<XuiConnection>("/api/v1/xui-connections", { method: "POST", body }),
  update: (id: string, body: Partial<{
    name: string; host: string; port: number;
    db_name: string; db_user: string; db_pass: string; is_default: boolean;
  }>) => api<XuiConnection>(`/api/v1/xui-connections/${id}`, { method: "PATCH", body }),
  remove: (id: string) => api<void>(`/api/v1/xui-connections/${id}`, { method: "DELETE" }),
  test: (id: string) => api<XuiTest>(`/api/v1/xui-connections/${id}/test`, { method: "POST" }),
  meta: (id: string) => api<XuiMeta>(`/api/v1/xui-connections/${id}/meta`),
};
