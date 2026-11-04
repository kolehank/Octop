/** Same-origin auth helpers for the big screen (shares the dashboard token). */

const TOKEN_KEY = "auth_token";
const RENEWED_HEADER = "X-Agentbuddy-Access-Token";

export class UnauthorizedError extends Error {}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  sessionStorage.removeItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

/** Exchange username/password for a JWT and store it under the shared key. */
export async function login(
  username: string,
  password: string,
  captchaToken?: string,
): Promise<void> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password,
      ...(captchaToken ? { captcha_token: captchaToken } : {}),
    }),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as {
        error?: { message?: string };
        detail?: string;
      };
      detail = body.error?.message ?? body.detail ?? "";
    } catch {
      // keep the generic message
    }
    throw new Error(detail || `登录失败（${response.status}）`);
  }
  const data = (await response.json()) as { access_token: string };
  setToken(data.access_token);
}

/** Fetch an Octop API path with Bearer auth + sliding-renewal handling. */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`/api${path}`, { ...init, headers });
  const renewed = response.headers.get(RENEWED_HEADER);
  if (renewed) setToken(renewed);
  if (response.status === 401) {
    throw new UnauthorizedError("登录已过期，请重新登录");
  }
  return response;
}
