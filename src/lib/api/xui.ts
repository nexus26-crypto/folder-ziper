import { api } from "@/lib/api";

export type PanelType = "auto" | "xtream_codes" | "xui_one" | "xui_r22";

export const PANEL_TYPE_LABELS: Record<PanelType, string> = {
  auto: "Autodetectar",
  xtream_codes: "Xtream Codes",
  xui_one: "XUI ONE",
  xui_r22: "XUI ONE r22+",
};

export type XuiConnection = {
  id: string;
  name: string;
  panel_type: PanelType;
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
  structure?: { panel_type?: PanelType; versao?: string };
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

export type CreatePanelBody = {
  name: string; panel_type: PanelType;
  host: string; port: number;
  db_name: string; db_user: string; db_pass: string;
  is_default?: boolean;
};

export const xuiApi = {
  list: () => api<XuiConnection[]>("/api/v1/xui-connections"),
  create: (body: CreatePanelBody) =>
    api<XuiConnection>("/api/v1/xui-connections", { method: "POST", body }),
  update: (id: string, body: Partial<CreatePanelBody>) =>
    api<XuiConnection>(`/api/v1/xui-connections/${id}`, { method: "PATCH", body }),
  remove: (id: string) => api<void>(`/api/v1/xui-connections/${id}`, { method: "DELETE" }),
  test: (id: string) => api<XuiTest>(`/api/v1/xui-connections/${id}/test`, { method: "POST" }),
  meta: (id: string) => api<XuiMeta>(`/api/v1/xui-connections/${id}/meta`),
};

// alias amigável — código chamando 'panelApi' também funciona
export const panelApi = xuiApi;
