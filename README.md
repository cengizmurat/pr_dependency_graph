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

## Folder Churn Counts Commits, Not Lines

The Folder churn tab answers how *often* an area of the repository changes. A
folder is modified by a commit when any file under it appears in that commit's
diff, and it counts **once** for that commit however deep the change sat or how
many of its files moved. Nested directories fold into the folder being listed:
inside `src/`, a commit touching both `src/mastra/tools` and `src/mastra/db`
counts once for `mastra`.

Type a path to drill in — `src/` lists the folders under `src`, `src/mastra/`
goes deeper, and an empty box means the repository root. `src`, `/src`, `./src/`
and `src//` all name the same folder, and a leading dot is kept, so `.github` is
a folder like any other. Files sitting directly in the folder rather than in a
subfolder get their own bucket, `(root files)` at the root and `(direct files)`
deeper down. A folder that no longer exists at the branch tip is badged `GONE`
rather than hidden — it was real churn at the time.

The box completes from every directory the history knows about, listed
top-down rather than as one flat alphabet: shallowest folders first, and within
each level the ones still at the branch tip ahead of the ones that only live in
the history, which are marked `(gone)`. Picking one fills in its plain path —
the marker is a label, never part of what you typed.

Two folder views are not a breakdown of each other. A change to
`src/mastra/tools/x.ts` counts for `src` at the root and for `mastra` inside
`src/`; they overlap rather than partition, and they are not meant to add up.
The trend chart is a set of separate lines for the same reason: one commit
touches several folders, so stacking them would draw a total that does not
exist. A colour belongs to a folder from the moment it joins the chart until it
leaves it, so changing the interval, branch, measure or bucket size never
repaints a line that is already drawn.

Merge commits are skipped: their file changes are already attributed to the
commits they bring in, so counting both would double every folder they pass
through. Renames are counted as a change to the folder the file left as well as
the one it joined.

### Nothing Is Read Until You Ask

The tab never fetches on its own. Under the controls sits a button saying
exactly what pressing it will cost — `Fetch 48 commits` — with the count beside
it, and until it is pressed not a single commit has been read.

That count is re-derived whenever an input that changes it is touched. It costs
one GraphQL request: the history query reports a `totalCount` for the branch,
interval and folder in one go. A second, bounded pass in the background walks
the commit list and subtracts what the cache already holds, so the button
settles on the number of requests that will actually reach GitHub rather than
the number of commits in the window. Where a window is all cache, it opens on
its own — there is nothing to ask about.

The estimate is weighed against what is left of the hourly budget, shown beside
it: how many requests remain of the limit, when the window resets and how long
that is. The first reading comes from `GET /rate_limit`, an endpoint that is
itself free. After that the counter follows the fetch request by request,
because every REST response states the budget it was charged against — so
watching it move costs nothing. It is picked out in a warning colour whenever
what remains cannot cover what is pending, and the same figure sits next to the
progress bar while commits are being read.

Once running, the charts are built from whatever has arrived, growing as
commits land, with a progress strip above them saying how much is still to
come. If the budget runs out mid-fetch, the reading stops there rather than
retrying into a wall an hour wide, and everything read so far stays on screen.

### A Folder Narrows the Fetch, Not Just the View

The folder box scopes the history query itself. GitHub's `history` connection
takes a `path`, so asking about `client/src/hooks` reads the commits that
touched that folder rather than every commit in the repository — on this
repository that is 3 requests instead of 48, and the saving grows with the size
of the repository relative to the folder.

The filter carries git's own path-filtering semantics, which simplify history
rather than walking every ancestor: where a merge is TREESAME to one parent,
git follows only that parent. A merge-heavy history can therefore report
slightly fewer commits for a path than `git log --full-history` would. Both
agree on ordinary histories, and a scoped view is self-consistent either way.

### Where the numbers come from

GitHub's GraphQL API has no field for the files a commit touched — `Commit`
carries additions, deletions and a changed-file count, but no diff — so the file
list comes from `GET /repos/{owner}/{repo}/commits/{sha}`, one request per
commit. GraphQL does the cheap half: the branch list, and the history query
above.

Nothing is ever fetched twice. A commit's diff cannot change, so the interned
per-commit records are kept in IndexedDB keyed by SHA, written incrementally as
they arrive and flushed when the page is hidden, so even an interrupted run
keeps what it read. The cache is per repository rather than per branch or
interval, so widening a window, switching branches or coming back tomorrow costs
only the commits that are genuinely new — and picking up after a rate-limit
reset fetches only the remainder. Commit dates are stored as days since the unix
epoch, so switching branches does not invalidate a selected date range, and
every folder prefix, time bucket and measure is recomputed in the browser
without refetching. (Where IndexedDB is unavailable, a capped `localStorage`
cache stands in.)

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

The author, reviewer, label, status and review-state filters — and the shortcut
buttons beside the legend — never take pull requests off the graph. Every open
PR in the date range stays drawn, with its dependencies intact; the ones a
filter keeps are shown at full strength and the rest fade back. So narrowing to
one author still shows their PRs in the context of the stacks they sit in, and
the header reads `2 of 5 open PRs`.

The author, reviewer and label menus each keep a pull request that matches any
one of the values picked in them, so adding a second value widens that filter.
Different menus narrow each other, though: an author and a label together mean
that author's PRs carrying that label. Every menu lists what picking each of its
values would actually leave on screen, counted with the other filters already
applied — the label menu is built from the labels the loaded PRs carry, not from
the repository's whole label list, so a label nobody has used never appears.

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
