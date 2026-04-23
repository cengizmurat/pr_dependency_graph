# PR Dependency Graph

A React application that visualizes pull request dependency graphs for GitHub repositories. It detects stacked PRs (where one PR's base branch is another PR's head branch) and renders an interactive D3.js directed acyclic graph.

![Example](./example.svg)

## Quick Start

### Docker

```bash
docker compose up
# Open http://localhost:8000
```

### Bash

```bash
cd client
npm install
npm run dev
# Open http://localhost:5173
```

Go to your browser, sign in with GitHub (or paste a personal access token in the Advanced section), then enter a repository in `owner/repo` format.

## How It Works

1. Sign in with GitHub via the OAuth App web flow (or paste a personal access token under "Advanced").
2. Enter a GitHub `owner/repo`.
3. The app fetches all open PRs directly from the GitHub GraphQL API.
4. Stacked PR dependencies are detected: if PR-B's base branch matches PR-A's head branch, PR-B depends on PR-A.
5. An interactive force-directed graph is rendered with clickable PR nodes.
