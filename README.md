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
5. PRs belonging to a native GitHub stack also carry their stack membership, read from the `stack` and `stackEntry` fields on the GraphQL `PullRequest` type. A stack badge on the card shows the PR's layer, e.g. `2/3`. GitHub rejects the update-branch endpoint for a stacked PR — a stack is rebased as a whole, and only the PR's own "Rebase Stack" button or `gh stack rebase` can ask for that — so the update badge opens the pull request instead. Repositories without GitHub's stacked pull requests are unaffected: the fields are dropped from the query and the branch heuristic above still applies.
6. An interactive force-directed graph is rendered with clickable PR nodes.

## Card Age Is Time in the Current State

The `x ago` on a pull request card is how long the PR has been draft or ready,
not how long ago it was opened. It comes from the PR's latest "ready for review"
or "convert to draft" timeline event, falling back to the creation time for a PR
that never switched — so a pull request that sat in draft for three days and was
made ready ten minutes ago reads `10m ago`. Hovering the age gives both dates.

The graph orders its cards by that same timestamp, freshest first. A stack is
ranked by its most recently changed pull request wherever in the stack that PR
sits, not by the one at the bottom: a top layer going ready for review brings
the whole stack forward. The rule applies at every level — the stacks opened
against a base branch, the base branches themselves, and the PRs stacked on one
parent. Stacks that changed at the same moment fall back to PR number, so the
order holds still across the automatic refresh.

## Filters Highlight, They Don't Hide

The author, reviewer, status and review-state filters — and the shortcut
buttons beside the legend — never take pull requests off the graph. Every open
PR in the date range stays drawn, with its dependencies intact; the ones a
filter keeps are shown at full strength and the rest fade back. So narrowing to
one author still shows their PRs in the context of the stacks they sit in, and
the header reads `2 of 5 open PRs`.

Focusing a PR works the same way and composes with the filters: a PR is picked
out when it satisfies both, so filtering inside a focused stack narrows that
stack instead of reaching back out into the rest of the graph.

### Shortcut Links Resolve to Whoever Opens Them

A shortcut can be linked to by name alone —
`https://<host>/owner/repo?shortcut=requested` or `?shortcut=mine` — without
spelling out the filters behind it. Those depend on who is looking, so the app
fills them in once it knows: `requested` becomes the reviewer set to you plus
`reviewState=REQUESTED`, `mine` becomes the author set to you. The address bar
is rewritten to the full filter set and the shortcut button lights up, exactly
as if it had been clicked.

Following such a link without being signed in sends you to the home page to
authorize, and back to the link afterwards — filters intact, resolved to your
account rather than the sharer's.

## Sharing a Stack of PRs

Every pull request card carries an eye badge that focuses the graph on that PR
and the PRs stacked on top of it: the stack is framed and the rest of the graph
fades back, and the page address becomes `https://<host>/owner/repo?pr=123`.
The banner above the graph names the focused PR, offers to copy that link so it
can be shared, and leads back to the full view. Opening the link elsewhere
reproduces the same focused view.

The same view can be reached without a link: paste a pull request URL
(`https://github.com/owner/repo/pull/123`) or type `owner/repo#123` into the
repository box on the home page.

Links are deliberately free of filters, so the recipient sees the stack rather
than the sharer's narrowed view. If the focused PR was opened before the
reader's default date range, the range is widened to the day it was opened so
the stack still loads; a PR that is closed, outside the reader's filters or
nonexistent is reported in the banner instead.
