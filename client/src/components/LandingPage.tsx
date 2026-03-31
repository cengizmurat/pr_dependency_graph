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
    background: "linear-gradient(135deg, #0d1117 0%, #161b22 100%)",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  },
  card: {
    background: "#1c2128",
    borderRadius: 12,
    padding: "48px 40px",
    maxWidth: 460,
    width: "100%",
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    textAlign: "center" as const,
  },
  title: {
    color: "#e6edf3",
    fontSize: 28,
    margin: "0 0 8px",
    fontWeight: 600,
  },
  subtitle: {
    color: "#8b949e",
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
    border: "1px solid #30363d",
    background: "#0d1117",
    color: "#e6edf3",
    outline: "none",
  },
  button: {
    padding: "10px 20px",
    fontSize: 15,
    fontWeight: 600,
    borderRadius: 6,
    border: "none",
    background: "#238636",
    color: "#fff",
    cursor: "pointer",
  },
  error: {
    color: "#f85149",
    fontSize: 13,
    marginTop: 12,
  },
};
