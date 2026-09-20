/**
 * Thin API client for the FastAPI backend.
 *
 * Server state is owned by TanStack Query (see app/providers.tsx). This module
 * only handles transport concerns: base URL, credentials, and the shared error
 * contract returned by the backend ({ error: { code, message, field_errors? } }).
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    field_errors?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message ?? "Request failed");
    this.name = "ApiError";
    this.status = status;
    this.code = body.error?.code ?? "unknown";
    this.fieldErrors = body.error?.field_errors;
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    // Session auth uses HttpOnly cookies; always include credentials.
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let body: ApiErrorBody;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = { error: { code: "http_error", message: response.statusText } };
    }
    throw new ApiError(response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

// ---- Backend wake-up (Render free tier sleeps after ~15 min idle) ----

/** Backend origin (without the /api/v1 suffix) — /health lives at the root. */
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, "");

/** Ping the public /health endpoint. Returns true if the server responded ok. */
export async function pingHealth(timeoutMs = 12_000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_ORIGIN}/health`, {
      signal: controller.signal,
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Poll /health until the backend is awake. Resolves true as soon as it responds
 * (immediately when already warm), or false after ~`maxWaitMs` of trying.
 */
export async function waitForBackend({
  maxWaitMs = 120_000,
  intervalMs = 2_500,
}: { maxWaitMs?: number; intervalMs?: number } = {}): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  // First attempt is immediate — a warm server returns right away.
  if (await pingHealth()) return true;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (await pingHealth()) return true;
  }
  return false;
}
