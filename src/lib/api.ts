/**
 * Cliente HTTP para a API VyntrixSync (FastAPI na VPS).
 * - Anexa Bearer token automaticamente
 * - Faz refresh transparente em 401
 * - Lança ApiError com mensagem legível
 */
import { useAuthStore } from "./auth-store";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

type FetchOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  auth?: boolean;
};

async function rawFetch(path: string, opts: FetchOptions = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  headers.set("Accept", "application/json");
  if (opts.body !== undefined && !(opts.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (opts.auth !== false) {
    const token = useAuthStore.getState().accessToken;
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const body =
    opts.body === undefined
      ? undefined
      : opts.body instanceof FormData
        ? opts.body
        : JSON.stringify(opts.body);

  return fetch(`${API_URL}${path}`, { ...opts, headers, body });
}

async function parseError(res: Response): Promise<ApiError> {
  let detail: unknown = undefined;
  let message = res.statusText || "Request failed";
  try {
    const data = await res.json();
    detail = data;
    if (typeof data?.detail === "string") message = data.detail;
    else if (Array.isArray(data?.detail)) message = data.detail.map((e: any) => e.msg).join(", ");
  } catch {
    /* ignore */
  }
  return new ApiError(message, res.status, detail);
}

async function tryRefresh(): Promise<boolean> {
  const { refreshToken, setTokens, logout } = useAuthStore.getState();
  if (!refreshToken) return false;
  const res = await rawFetch("/api/v1/auth/refresh", {
    method: "POST",
    body: { refresh_token: refreshToken },
    auth: false,
  });
  if (!res.ok) {
    logout();
    return false;
  }
  const data = await res.json();
  setTokens(data.access_token, data.refresh_token);
  return true;
}

export async function api<T = unknown>(path: string, opts: FetchOptions = {}): Promise<T> {
  let res = await rawFetch(path, opts);
  if (res.status === 401 && opts.auth !== false) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await rawFetch(path, opts);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
