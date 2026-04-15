import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useGithubToken } from "../hooks/useGithubToken";
import { styles } from "./LandingPage.styles";

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
              Your token is only stored in your browser's localStorage and is
              never sent to any server other than GitHub's API
            </p>
          </>
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
