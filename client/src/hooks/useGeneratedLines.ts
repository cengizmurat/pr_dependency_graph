import { useMemo } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPRChangedFiles, fetchRootGitattributes } from "../api";
import { measureGenerated, parseGeneratedRules } from "../gitattributes";
import type { ChangedFile, GeneratedLines, GraphQLPullRequest } from "../types";

// A PR's file list only changes when its head moves or it is retargeted, so
// these three name one list for good.
function filesKey(pr: GraphQLPullRequest): string {
  return `${pr.number}@${pr.headRefOid}@${pr.baseRefName}`;
}

// Every file list read this session, per repository. The 15-minute refresh
// brings back the same heads, so it costs nothing, and a PR only goes back to
// its spinner when it gets new commits. Null marks a list that could not be
// read. `inFlight` lets a second run wait for a list the first run is already
// reading instead of asking again — which is what happens when the next page
// of PRs lands while the first page's lists are still loading.
interface RepoFiles {
  lists: Map<string, ChangedFile[] | null>;
  inFlight: Map<string, Promise<void>>;
}

const stores = new Map<string, RepoFiles>();

function getStore(owner: string, repo: string): RepoFiles {
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  let store = stores.get(key);
  if (!store) {
    store = { lists: new Map(), inFlight: new Map() };
    stores.set(key, store);
  }
  return store;
}

// The lists known so far for one set of PRs, by filesKey. A PR missing from
// it is still loading.
type FilesSnapshot = ReadonlyMap<string, ChangedFile[] | null>;

// The generated lines to take off each PR's +/−, judged by the root
// .gitattributes on the default branch. A PR maps to "loading" until its own
// file list is in; the others show as soon as theirs are. Null when nothing
// is taken off at all: the setting is off, or the repository marks nothing as
// generated — then no file list is read and no card waits.
export function useGeneratedLines({
  token,
  owner,
  repo,
  prs,
  enabled,
}: {
  token: string | null;
  owner: string | undefined;
  repo: string | undefined;
  prs: readonly GraphQLPullRequest[];
  enabled: boolean;
}): ReadonlyMap<number, GeneratedLines | "loading"> | null {
  const queryClient = useQueryClient();
  const active = enabled && !!token && !!owner && !!repo;

  // Needs nothing from the PR list, so it runs alongside it and is usually
  // back before the first cards are drawn.
  const attributesQuery = useQuery({
    queryKey: ["gitattributes", owner, repo],
    queryFn: () => fetchRootGitattributes(token!, owner!, repo!),
    enabled: active,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const rules = useMemo(
    () => (attributesQuery.data ? parseGeneratedRules(attributesQuery.data.text) : []),
    [attributesQuery.data],
  );
  // Lines that only take the mark away cannot leave anything out.
  const marksAnything = rules.some((rule) => rule.generated);

  const prKeys = prs.map(filesKey).join(",");
  const filesQuery = useQuery({
    queryKey: ["prChangedFiles", owner, repo, prKeys],
    enabled: active && marksAnything && prs.length > 0,
    // Keyed by head commit, a list never goes stale.
    staleTime: Infinity,
    // Failures are handled per PR below; a retry here would read them all again.
    retry: false,
    // When the next page of PRs changes the key, the cards that already have
    // their numbers keep them instead of going back to a spinner.
    placeholderData: keepPreviousData,
    queryFn: async ({ queryKey }): Promise<FilesSnapshot> => {
      const store = getStore(owner!, repo!);
      const keys = prs.map(filesKey);
      const snapshot = (): FilesSnapshot => {
        const known = new Map<string, ChangedFile[] | null>();
        for (const key of keys) {
          const list = store.lists.get(key);
          if (list !== undefined) known.set(key, list);
        }
        return known;
      };
      const publish = () => {
        queryClient.setQueryData(queryKey, snapshot());
      };

      const toRead = new Map<number, string>();
      const waiting: Promise<void>[] = [];
      for (const pr of prs) {
        const key = filesKey(pr);
        if (store.lists.get(key)) continue;
        const inFlight = store.inFlight.get(key);
        if (inFlight) {
          waiting.push(inFlight.then(publish));
          continue;
        }
        // A list that could not be read last time is tried again.
        store.lists.delete(key);
        toRead.set(pr.number, key);
      }
      if (toRead.size === 0 && waiting.length === 0) return snapshot();

      const settle = new Map<string, () => void>();
      for (const key of toRead.values()) {
        store.inFlight.set(key, new Promise<void>((resolve) => settle.set(key, resolve)));
      }
      const finish = (key: string, files: ChangedFile[] | null) => {
        store.lists.set(key, files);
        store.inFlight.delete(key);
        settle.get(key)?.();
      };

      // What is already known shows at once; the rest follows PR by PR.
      publish();

      const reading =
        toRead.size === 0
          ? Promise.resolve()
          : fetchPRChangedFiles(token!, owner!, repo!, [...toRead.keys()], (number, files) => {
              const key = toRead.get(number);
              if (key === undefined) return;
              finish(key, files);
              publish();
            }).finally(() => {
              // Whatever the reader never reported is given up on, so no card
              // is left spinning.
              for (const key of toRead.values()) {
                if (store.inFlight.has(key)) finish(key, null);
              }
            });

      await Promise.all([reading, ...waiting]);
      return snapshot();
    },
  });

  return useMemo(() => {
    if (!active) return null;

    const states = new Map<number, GeneratedLines | "loading">();
    // Until the rules are in, no card can tell whether its numbers change.
    if (attributesQuery.isPending) {
      for (const pr of prs) states.set(pr.number, "loading");
      return states;
    }
    // No rules — or no file to read them from — leaves GitHub's numbers.
    if (!marksAnything) return null;

    const known = filesQuery.data;
    for (const pr of prs) {
      const list = known?.get(filesKey(pr));
      if (list === undefined) {
        // A run that failed outright leaves GitHub's numbers, not a spinner.
        if (!filesQuery.isError) states.set(pr.number, "loading");
      } else if (list !== null) {
        states.set(pr.number, measureGenerated(list, rules));
      }
    }
    return states;
  }, [
    active,
    attributesQuery.isPending,
    marksAnything,
    filesQuery.data,
    filesQuery.isError,
    prs,
    rules,
  ]);
}
