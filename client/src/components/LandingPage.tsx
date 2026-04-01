import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

export default function LandingPage() {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim().replace(/^\/+|\/+$/g, "");
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
        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
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
  error: {
    color: "var(--color-error)",
    fontSize: 13,
    marginTop: 12,
  },
};
