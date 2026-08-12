import { useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useGithubToken } from "../hooks/useGithubToken";
import { useIsMobile } from "../hooks/useIsMobile";
import { isOAuthConfigured, MANAGE_OAUTH_APPS_URL, startLogin } from "../auth";
import { fetchUserRepos } from "../api";
import { FOCUS_PR_PARAM, parseRepoTarget } from "../prFocus";
import type { UserRepo } from "../types";
import { styles } from "./LandingPage.styles";

export default function LandingPage() {
  const { token, source, setToken, clearToken } = useGithubToken();
  const [tokenInput, setTokenInput] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [error, setError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const oauthEnabled = isOAuthConfigured();

  // Where the visitor was headed when they were bounced here for lacking
  // credentials, filters and all. Signing in takes them back to it instead of
  // leaving them on the repository box with the link they followed forgotten.
  const returnTo = (location.state as { from?: unknown } | null)?.from;
  const redirectTo = typeof returnTo === "string" && returnTo.startsWith("/")
    ? returnTo
    : null;

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
      // The OAuth round trip leaves the app entirely, so the destination is
      // handed to `startLogin`, which parks it until the callback returns.
      startLogin(redirectTo ?? undefined);
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
      // A token typed in never leaves the app, so the destination is still in
      // hand and can be resumed straight away.
      if (redirectTo) navigate(redirectTo, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Opens the graph for a repository, focused on one PR and the stack above it
  // when the entry names one — `owner/repo#42`, or a pull request URL pasted
  // straight from GitHub.
  function navigateToRepo(fullName: string) {
    const target = parseRepoTarget(fullName);
    if (!target) {
      setError("Please enter a valid owner/repo (e.g. facebook/react)");
      return;
    }

    const { prNumber } = target;
    const suffix =
      prNumber && prNumber > 0 ? `?${FOCUS_PR_PARAM}=${prNumber}` : "";
    navigate(`/${target.owner}/${target.repo}${suffix}`);
  }

  function handleRepoSubmit(e: FormEvent) {
    e.preventDefault();
    navigateToRepo(repoInput);
  }

  return (
    <div style={styles.container}>
      <div style={{ ...styles.card, ...(isMobile ? styles.cardMobile : {}) }}>
        <h1 style={{ ...styles.title, ...(isMobile ? styles.titleMobile : {}) }}>
          PR Dependency Graph
        </h1>
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
            <p style={styles.helperLine}>
              Pasting a pull request URL opens the graph focused on that pull
              request and the ones stacked on top of it.
            </p>
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
