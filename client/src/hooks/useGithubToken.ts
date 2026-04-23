import { useCallback, useSyncExternalStore } from "react";
import {
  STORAGE_KEY,
  type StoredAuth,
  logout as authLogout,
  readStoredAuth,
  setPatAuth,
  subscribeAuthChange,
} from "../auth";

// useSyncExternalStore requires getSnapshot to return a referentially stable
// value while the underlying data is unchanged, otherwise React detects an
// infinite render loop and bails out. We cache the parsed StoredAuth keyed by
// the raw localStorage string and only re-parse when the raw value changes.
let cachedRaw: string | null = null;
let cachedAuth: StoredAuth | null = null;
let cacheInitialized = false;

function getSnapshot(): StoredAuth | null {
  const raw = typeof window === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  if (cacheInitialized && raw === cachedRaw) return cachedAuth;
  cachedRaw = raw;
  cachedAuth = readStoredAuth();
  cacheInitialized = true;
  return cachedAuth;
}

function getServerSnapshot(): StoredAuth | null {
  return null;
}

export function useGithubToken() {
  const auth = useSyncExternalStore(
    subscribeAuthChange,
    getSnapshot,
    getServerSnapshot,
  );

  const setToken = useCallback((value: string) => {
    setPatAuth(value);
  }, []);

  const clearToken = useCallback(() => {
    authLogout();
  }, []);

  return {
    token: auth?.accessToken ?? null,
    source: auth?.source ?? null,
    setToken,
    clearToken,
  } as const;
}
