import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { consumeReturnTo, handleCallback } from "../auth";
import { styles } from "./LandingPage.styles";

export default function AuthCallback() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);

    handleCallback(params)
      .then(() => {
        if (cancelled) return;
        // If the user just installed the App on more repos, refetch the
        // accessible-repos list so the new ones show up in the dropdown.
        if (params.get("setup_action") || params.get("installation_id")) {
          queryClient.invalidateQueries({ queryKey: ["accessibleRepos"] });
        }
        const returnTo = consumeReturnTo();
        navigate(returnTo, { replace: true });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, queryClient]);

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Signing in</h1>
        {!error ? (
          <p style={styles.subtitle}>
            Completing GitHub authorization, please wait...
          </p>
        ) : (
          <>
            <p style={styles.subtitle}>We could not finish signing you in.</p>
            <p style={styles.error}>{error}</p>
            <button
              type="button"
              onClick={() => navigate("/", { replace: true })}
              style={styles.button}
            >
              Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
