import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useGithubToken } from "../hooks/useGithubToken";
import { isOAuthConfigured, MANAGE_OAUTH_APPS_URL, startLogin } from "../auth";
import { fetchUserRepos } from "../api";
import type { UserRepo } from "../types";
import { styles } from "./LandingPage.styles";

export default function LandingPage() {
  const { token, source, setToken, clearToken } = useGithubToken();
  const [tokenInput, setTokenInput] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [error, setError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const navigate = useNavigate();
  const oauthEnabled = isOAuthConfigured();

  const {
    data: userRepos,
    isLoading: reposLoading,
    error: reposError,
  } = useQuery({
    queryKey: ["userRepos", token],
    queryFn: () => fetchUserRepos(token!),
    enabled: !!token && source === "oauth",
    staleTime: 60 * 1000,
  });

  const groupedOptions = useMemo(() => {
    if (!userRepos) return [];
    const byOwner = new Map<string, UserRepo[]>();
    for (const r of userRepos) {
      const list = byOwner.get(r.owner) ?? [];
      list.push(r);
      byOwner.set(r.owner, list);
    }
    return [...byOwner.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([owner, repos]) => ({
        label: owner,
        title: owner,
        options: repos.map((r) => ({
          label: r.fullName,
          value: r.fullName,
        })),
      }));
  }, [userRepos]);

  function handleSignIn() {
    try {
      startLogin();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function handleSaveToken(e: FormEvent) {
    e.preventDefault();
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setError("Please enter a GitHub token");
      return;
    }
    try {
      setToken(trimmed);
      setTokenInput("");
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function navigateToRepo(fullName: string) {
    const trimmed = fullName.trim().replace(/^\/+|\/+$/g, "");
    const parts = trimmed.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      setError("Please enter a valid owner/repo (e.g. facebook/react)");
      return;
    }
    navigate(`/${parts[0]}/${parts[1]}`);
  }

  function handleRepoSubmit(e: FormEvent) {
    e.preventDefault();
    navigateToRepo(repoInput);
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>PR Dependency Graph</h1>
        <p style={styles.subtitle}>
          Visualize pull request dependencies for any GitHub repository
        </p>

        {!token ? (
          <>
            {oauthEnabled && (
              <>
                <button
                  type="button"
                  onClick={handleSignIn}
                  style={styles.signInButton}
                >
                  Sign in with GitHub
                </button>
                <p style={styles.disclaimer}>
                  You will be redirected to GitHub to authorize this app.
                </p>
                <div style={styles.divider}>
                  <span style={styles.dividerLine} />
                  <span>or</span>
                  <span style={styles.dividerLine} />
                </div>
              </>
            )}

            {!oauthEnabled || showAdvanced ? (
              <>
                <form onSubmit={handleSaveToken} style={styles.form}>
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={(e) => {
                      setTokenInput(e.target.value);
                      setError("");
                    }}
                    placeholder="GitHub personal access token"
                    style={styles.input}
                    autoFocus
                  />
                  <button type="submit" style={styles.button}>
                    Save
                  </button>
                </form>
                <p style={styles.disclaimer}>
                  Your token is only stored in your browser's localStorage and
                  is never sent to any server other than GitHub's API.
                </p>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowAdvanced(true)}
                style={styles.advancedToggle}
              >
                Advanced: use a personal access token
              </button>
            )}
          </>
        ) : (
          <>
            {source === "oauth" && (
              <div style={styles.repoPickerSection}>
                <Select
                  showSearch
                  allowClear
                  placeholder={
                    reposLoading
                      ? "Loading your accessible repos..."
                      : groupedOptions.length === 0
                        ? "No accessible repos yet"
                        : "Pick a repository"
                  }
                  loading={reposLoading}
                  options={groupedOptions}
                  onChange={(value) => value && navigateToRepo(value as string)}
                  optionFilterProp="label"
                  style={styles.select}
                  notFoundContent={
                    reposError ? (
                      <span style={{ color: "var(--color-error)" }}>
                        {(reposError as Error).message}
                      </span>
                    ) : undefined
                  }
                />
                {!reposLoading && (
                  <p style={styles.helperLine}>
                    {userRepos?.length ?? 0} repo
                    {(userRepos?.length ?? 0) === 1 ? "" : "s"} available
                    {" - "}
                    <a
                      href={MANAGE_OAUTH_APPS_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={styles.helperLink}
                    >
                      Manage authorized apps
                    </a>
                  </p>
                )}
                <div style={styles.divider}>
                  <span style={styles.dividerLine} />
                  <span>or type one</span>
                  <span style={styles.dividerLine} />
                </div>
              </div>
            )}

            <form onSubmit={handleRepoSubmit} style={styles.form}>
              <input
                type="text"
                value={repoInput}
                onChange={(e) => {
                  setRepoInput(e.target.value);
                  setError("");
                }}
                placeholder="owner/repo"
                style={styles.input}
                autoFocus={source !== "oauth"}
              />
              <button type="submit" style={styles.button}>
                View Graph
              </button>
            </form>
            <button
              onClick={() => {
                clearToken();
                setError("");
              }}
              style={styles.clearButton}
            >
              Sign out
            </button>
          </>
        )}

        {error && <p style={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
