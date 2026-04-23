/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_OAUTH_CLIENT_ID?: string;
  /** @deprecated kept for backwards compatibility with the old GitHub-App env var name. */
  readonly VITE_GITHUB_APP_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
