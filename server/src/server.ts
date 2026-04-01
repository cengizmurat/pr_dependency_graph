import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { fetchOpenPRs, fetchViewerLogin } from "./github.js";
import { buildDependencyGraph } from "./graph.js";

const app = express();
const PORT = parseInt(process.env.PORT ?? "8000", 10);

app.use(cors());

app.get("/api/:owner/:repo", async (req, res) => {
  const { owner, repo } = req.params;

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(500).json({ error: "GITHUB_TOKEN is not configured" });
    return;
  }

  try {
    const [prs, viewerLogin] = await Promise.all([
      fetchOpenPRs(token, owner, repo),
      fetchViewerLogin(token),
    ]);
    const graph = buildDependencyGraph(prs, owner, repo);
    graph.viewerLogin = viewerLogin;
    res.json(graph);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Failed to fetch PRs for ${owner}/${repo}:`, message);
    res.status(502).json({ error: `GitHub API error: ${message}` });
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, "..", "client");

app.use(express.static(clientDist));

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
