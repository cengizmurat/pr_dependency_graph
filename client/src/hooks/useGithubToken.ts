import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "github_token";

export function useGithubToken() {
  const [token, setTokenState] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        setTokenState(e.newValue);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setToken = useCallback((value: string) => {
    localStorage.setItem(STORAGE_KEY, value);
    setTokenState(value);
  }, []);

  const clearToken = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setTokenState(null);
  }, []);

  return { token, setToken, clearToken } as const;
}
