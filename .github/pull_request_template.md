## Summary

<!-- Two sentences: what this PR changes. State it plainly and leave the assessment to the reviewer. -->

## Background

<!-- What was true before this PR, and why that was a problem. Keep it to a short paragraph. -->

## Lifecycle

<!--
  A graph of what this change makes move —
  mark what this PR touches (`:::changed` on a node; a transition that changed between two nodes
  that did not is marked differently — .github/lifecycle-graphs.md says how), and paste it here
  inside a mermaid code fence. GitHub renders it inline.

  Include one when the PR changes how something travels through the system rather than only what
  it computes. The cases below are examples to give you ideas, not a full list — anything else with
  a lifecycle worth drawing counts too:
    · a Drizzle migration, or a schema change split across releases (expand / cut over / contract)
    · a new or re-routed path between workspaces
    · a new status field, queue or state machine, or a change to an existing one

  Delete the section when the change is local and nothing about its lifecycle moves.
-->

## Screenshots  <!-- Frontend changes: before / after. Delete otherwise. -->

## Risk & rollback

<!-- How this fails in production and what the operator does about it. Delete when nothing can.
     · migration: does the deployed image survive the new schema, and the new image the old one?
     · feature flag or kill switch, and its default
     · rollback: revert and redeploy, or is a manual step needed? There are no down migrations. -->
