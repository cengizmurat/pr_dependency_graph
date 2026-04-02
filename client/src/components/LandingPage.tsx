import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useGithubToken } from "../hooks/useGithubToken";

export default function LandingPage() {
  const { token, setToken, clearToken } = useGithubToken();
  const [tokenInput, setTokenInput] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  function handleSaveToken(e: FormEvent) {
    e.preventDefault();
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setError("Please enter a GitHub token");
      return;
    }
    setToken(trimmed);
    setTokenInput("");
    setError("");
  }

  function handleRepoSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = repoInput.trim().replace(/^\/+|\/+$/g, "");
    const parts = trimmed.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      setError("Please enter a valid owner/repo (e.g. facebook/react)");
      return;
    }
    navigate(`/${parts[0]}/${parts[1]}`);
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>PR Dependency Graph</h1>
        <p style={styles.subtitle}>
          Visualize pull request dependencies for any GitHub repository
        </p>

        {!token ? (
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
        ) : (
          <>
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
                autoFocus
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
              Clear Token
            </button>
          </>
        )}

        {error && <p style={styles.error}>{error}</p>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    background:
      "linear-gradient(135deg, var(--color-gradient-from) 0%, var(--color-gradient-to) 100%)",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  },
  card: {
    background: "var(--color-card-bg)",
    borderRadius: 12,
    padding: "48px 40px",
    maxWidth: 460,
    width: "100%",
    boxShadow: "0 8px 32px var(--color-shadow)",
    textAlign: "center" as const,
  },
  title: {
    color: "var(--color-text)",
    fontSize: 28,
    margin: "0 0 8px",
    fontWeight: 600,
  },
  subtitle: {
    color: "var(--color-text-secondary)",
    fontSize: 15,
    margin: "0 0 32px",
  },
  form: {
    display: "flex",
    gap: 8,
  },
  input: {
    flex: 1,
    padding: "10px 14px",
    fontSize: 15,
    borderRadius: 6,
    border: "1px solid var(--color-border)",
    background: "var(--color-input-bg)",
    color: "var(--color-text)",
    outline: "none",
  },
  button: {
    padding: "10px 20px",
    fontSize: 15,
    fontWeight: 600,
    borderRadius: 6,
    border: "none",
    background: "var(--color-button-bg)",
    color: "var(--color-button-text)",
    cursor: "pointer",
  },
  clearButton: {
    marginTop: 12,
    padding: "6px 16px",
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 6,
    border: "1px solid var(--color-border)",
    background: "transparent",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  },
  error: {
    color: "var(--color-error)",
    fontSize: 13,
    marginTop: 12,
  },
};
