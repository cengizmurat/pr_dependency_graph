import type { GraphData } from "./types";

export async function fetchGraph(
  owner: string,
  repo: string
): Promise<GraphData> {
  const res = await fetch(`/api/${owner}/${repo}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      body?.error ?? `Request failed with status ${res.status}`
    );
  }
  return res.json();
}
