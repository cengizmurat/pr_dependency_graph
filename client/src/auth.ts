export const STORAGE_KEY = "github_token";
const OAUTH_STATE_KEY = "github_oauth_state";
const OAUTH_RETURN_TO_KEY = "github_oauth_return_to";
const AUTH_CHANGE_EVENT = "github-auth-change";

const REFRESH_LEEWAY_MS = 60 * 1000;

// Allow the legacy `VITE_GITHUB_APP_CLIENT_ID` name as a fallback so users don't
// have to rename their local env vars during the GitHub-App -> OAuth-App switch.
const CLIENT_ID =
  import.meta.env.VITE_GITHUB_OAUTH_CLIENT_ID ??
  import.meta.env.VITE_GITHUB_APP_CLIENT_ID ??
  "";

// Scopes requested for the OAuth App. `repo` covers reading/writing PRs on any
// repo the user can access (including private repos in orgs they belong to,
// subject to the org's OAuth App access policy).
const OAUTH_SCOPES = "repo";

export type StoredAuth =
  | { source: "pat"; accessToken: string }
  | {
      source: "oauth";
      accessToken: string;
      // OAuth Apps do not issue refresh tokens by default. These fields are
      // only populated if the (rarely used) token-rotation feature is enabled
      // on the OAuth App, in which case we'll honour the refresh flow.
      refreshToken?: string;
      expiresAt?: number;
    };

interface GitHubTokenResponseBody {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
}

interface GitHubTokenErrorBody {
  error: string;
  error_description?: string;
}

export class AuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AuthError";
  }
}

function notifyChange(): void {
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export function subscribeAuthChange(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  window.addEventListener(AUTH_CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function readStoredAuth(): StoredAuth | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredAuth> & { source?: string };
    if (parsed?.source === "pat" && typeof parsed.accessToken === "string") {
      return { source: "pat", accessToken: parsed.accessToken };
    }
    if (parsed?.source === "oauth" && typeof parsed.accessToken === "string") {
      const refreshToken = (parsed as { refreshToken?: unknown }).refreshToken;
      const expiresAt = (parsed as { expiresAt?: unknown }).expiresAt;
      return {
        source: "oauth",
        accessToken: parsed.accessToken,
        refreshToken: typeof refreshToken === "string" ? refreshToken : undefined,
        expiresAt: typeof expiresAt === "number" ? expiresAt : undefined,
      };
    }
  } catch {
    // Legacy format: a bare PAT string. Migrate it to the new shape.
    const migrated: StoredAuth = { source: "pat", accessToken: raw };
    writeStoredAuth(migrated);
    return migrated;
  }

  return null;
}

function writeStoredAuth(auth: StoredAuth): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  notifyChange();
}

export function setPatAuth(token: string): void {
  const trimmed = token.trim();
  if (!trimmed) throw new AuthError("empty_token", "Token cannot be empty.");
  writeStoredAuth({ source: "pat", accessToken: trimmed });
}

function setOAuthAuth(input: {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}): void {
  writeStoredAuth({
    source: "oauth",
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresIn ? Date.now() + input.expiresIn * 1000 : undefined,
  });
}

export function logout(): void {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_RETURN_TO_KEY);
  notifyChange();
}

// URL where the user can review/revoke this OAuth App's authorization. We can't
// deep-link to a specific app (no slug exists for OAuth Apps), so just take the
// user to the list of authorized apps.
export const MANAGE_OAUTH_APPS_URL = "https://github.com/settings/applications";

export function isOAuthConfigured(): boolean {
  return Boolean(CLIENT_ID);
}

function generateState(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function startLogin(returnTo?: string): void {
  if (!CLIENT_ID) {
    throw new AuthError(
      "oauth_not_configured",
      "VITE_GITHUB_OAUTH_CLIENT_ID is not set; OAuth login is unavailable.",
    );
  }
  const state = generateState();
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  if (returnTo) sessionStorage.setItem(OAUTH_RETURN_TO_KEY, returnTo);

  const redirectUri = `${window.location.origin}/auth/callback`;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    scope: OAUTH_SCOPES,
    allow_signup: "false",
  });
  window.location.href = `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export function consumeReturnTo(): string {
  const returnTo = sessionStorage.getItem(OAUTH_RETURN_TO_KEY);
  sessionStorage.removeItem(OAUTH_RETURN_TO_KEY);
  return returnTo && returnTo.startsWith("/") ? returnTo : "/";
}

// Cache the in-flight callback promise so React StrictMode's double-invoked
// effects (or any other accidental double-call) reuse the first result instead
// of consuming the OAuth state/code twice.
let inFlightCallback: { code: string; promise: Promise<void> } | null = null;

export function handleCallback(searchParams: URLSearchParams): Promise<void> {
  const code = searchParams.get("code") ?? "";
  if (inFlightCallback && inFlightCallback.code === code) {
    return inFlightCallback.promise;
  }

  const promise = runCallback(searchParams).catch((err) => {
    inFlightCallback = null;
    throw err;
  });
  inFlightCallback = { code, promise };
  return promise;
}

async function runCallback(searchParams: URLSearchParams): Promise<void> {
  const error = searchParams.get("error");
  if (error) {
    throw new AuthError(
      error,
      searchParams.get("error_description") ?? "GitHub returned an error.",
    );
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);

  if (!code) {
    throw new AuthError("missing_code", "GitHub did not return an authorization code.");
  }
  if (!state || state !== expectedState) {
    throw new AuthError(
      "state_mismatch",
      "OAuth state mismatch. Please try signing in again.",
    );
  }

  const res = await fetch("/api/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data: GitHubTokenResponseBody | GitHubTokenErrorBody = await res
    .json()
    .catch(() => ({ error: "bad_response" }) as GitHubTokenErrorBody);

  if (!res.ok || "error" in data) {
    const err = data as GitHubTokenErrorBody;
    throw new AuthError(
      err.error ?? "exchange_failed",
      err.error_description ?? `Token exchange failed (HTTP ${res.status}).`,
    );
  }

  if (!data.access_token) {
    throw new AuthError(
      "missing_access_token",
      "GitHub did not return an access token.",
    );
  }

  setOAuthAuth({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  });
}

let inFlightRefresh: Promise<StoredAuth> | null = null;

async function refreshOAuth(
  current: StoredAuth & { source: "oauth"; refreshToken: string },
): Promise<StoredAuth> {
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: current.refreshToken }),
      });
      const data: GitHubTokenResponseBody | GitHubTokenErrorBody = await res
        .json()
        .catch(() => ({ error: "bad_response" }) as GitHubTokenErrorBody);

      if (!res.ok || "error" in data) {
        const err = data as GitHubTokenErrorBody;
        // Refresh token is unrecoverable: drop credentials so the UI prompts re-login.
        logout();
        throw new AuthError(
          err.error ?? "refresh_failed",
          err.error_description ?? `Token refresh failed (HTTP ${res.status}).`,
        );
      }

      if (!data.access_token) {
        logout();
        throw new AuthError(
          "missing_access_token",
          "GitHub did not return an access token on refresh.",
        );
      }

      const next: StoredAuth = {
        source: "oauth",
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? current.refreshToken,
        expiresAt: data.expires_in
          ? Date.now() + data.expires_in * 1000
          : undefined,
      };
      writeStoredAuth(next);
      return next;
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

export async function getToken(
  options: { forceRefresh?: boolean } = {},
): Promise<string> {
  const auth = readStoredAuth();
  if (!auth) throw new AuthError("not_signed_in", "Not signed in.");
  if (auth.source === "pat") return auth.accessToken;

  // OAuth App tokens don't expire by default, so unless we have a refresh
  // token we can't do anything but return what we have.
  if (!auth.refreshToken) return auth.accessToken;

  const expired =
    auth.expiresAt != null && auth.expiresAt - REFRESH_LEEWAY_MS <= Date.now();
  if (!options.forceRefresh && !expired) return auth.accessToken;

  const refreshed = await refreshOAuth({
    ...auth,
    refreshToken: auth.refreshToken,
  });
  return refreshed.accessToken;
}
