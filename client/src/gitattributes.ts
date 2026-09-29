import type { ChangedFile, GeneratedLines } from "./types";

// Which files a repository's root .gitattributes marks as generated, read the
// way git and GitHub's Linguist read it. Only `linguist-generated` matters
// here; every other attribute on a line is ignored.
//
// Patterns follow .gitignore rules, with the two differences .gitattributes
// makes: a negative pattern (`!foo`) is not allowed, and a pattern naming a
// folder does not reach the files inside it — `dist/` matches nothing here,
// `dist/**` is what marks a folder's contents. Macro lines (`[attr]name …`)
// are not supported.

const ATTRIBUTE = "linguist-generated";

export interface GeneratedRule {
  // Tested against a repository-relative path such as `src/api/client.ts`.
  test: RegExp;
  // What the line says about the paths it matches. Linguist counts any value
  // but "false" as generated; `-linguist-generated`, `=false` and
  // `!linguist-generated` all take the mark away again.
  generated: boolean;
}

export function parseGeneratedRules(text: string): GeneratedRule[] {
  const rules: GeneratedRule[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("[attr]")) continue;

    const split = splitPattern(line);
    if (!split || split.pattern === "" || split.pattern.startsWith("!")) continue;

    // The last mention on a line is the one that counts, as in git.
    let generated: boolean | undefined;
    for (const token of split.rest.split(/\s+/)) {
      if (token === ATTRIBUTE) generated = true;
      else if (token === `-${ATTRIBUTE}` || token === `!${ATTRIBUTE}`) generated = false;
      else if (token.startsWith(`${ATTRIBUTE}=`)) {
        generated = token.slice(ATTRIBUTE.length + 1) !== "false";
      }
    }
    if (generated === undefined) continue;

    const test = compilePattern(split.pattern);
    if (test) rules.push({ test, generated });
  }
  return rules;
}

// A later line overrides an earlier one, so the rules are read from the end
// and the first match decides.
export function isGeneratedPath(path: string, rules: readonly GeneratedRule[]): boolean {
  for (let i = rules.length - 1; i >= 0; i--) {
    if (rules[i].test.test(path)) return rules[i].generated;
  }
  return false;
}

export function measureGenerated(
  files: readonly ChangedFile[],
  rules: readonly GeneratedRule[],
): GeneratedLines {
  const total: GeneratedLines = { additions: 0, deletions: 0, files: 0 };
  for (const file of files) {
    if (!isGeneratedPath(file.path, rules)) continue;
    total.additions += file.additions;
    total.deletions += file.deletions;
    total.files += 1;
  }
  return total;
}

// The pattern is the line's first word, or a C-style quoted string when it
// starts with a double quote — git's way of writing a path with spaces in it.
function splitPattern(line: string): { pattern: string; rest: string } | null {
  if (!line.startsWith('"')) {
    const end = line.search(/\s/);
    return end === -1
      ? { pattern: line, rest: "" }
      : { pattern: line.slice(0, end), rest: line.slice(end) };
  }

  const escapes: Record<string, string> = {
    a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v",
  };
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  let i = 1;
  while (i < line.length && line[i] !== '"') {
    let text = line[i];
    if (text === "\\" && i + 1 < line.length) {
      // Three octal digits are one byte of the UTF-8 path.
      const octal = line.slice(i + 1, i + 4);
      if (/^[0-7]{3}$/.test(octal)) {
        bytes.push(parseInt(octal, 8));
        i += 4;
        continue;
      }
      text = escapes[line[i + 1]] ?? line[i + 1];
      i += 2;
    } else {
      i += 1;
    }
    bytes.push(...encoder.encode(text));
  }
  if (i >= line.length) return null;
  return {
    pattern: new TextDecoder().decode(new Uint8Array(bytes)),
    rest: line.slice(i + 1),
  };
}

function compilePattern(pattern: string): RegExp | null {
  // A trailing slash names a folder, and a folder's attributes are not
  // passed on to the files in it.
  if (pattern.endsWith("/")) return null;

  // A slash at the start or in the middle ties the pattern to the root.
  // Without one it matches a file's name in any folder.
  const anchored = pattern.includes("/");
  const source = globSource(pattern.startsWith("/") ? pattern.slice(1) : pattern);
  if (source === null) return null;
  try {
    return new RegExp(anchored ? `^${source}$` : `(?:^|/)${source}$`);
  } catch {
    // An invalid range such as [z-a].
    return null;
  }
}

// Git's wildmatch as a RegExp source: `*` and `?` stay inside one folder, and
// `**` crosses folders only as a whole path segment. Null when the pattern is
// one git never matches, or uses something this reader does not support.
function globSource(glob: string): string | null {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];

    if (c === "*") {
      let end = i;
      while (glob[end] === "*") end++;
      const wholeSegment =
        end - i === 2 &&
        (i === 0 || glob[i - 1] === "/") &&
        (end === glob.length || glob[end] === "/");
      if (!wholeSegment) {
        out += "[^/]*";
        i = end;
      } else if (end === glob.length) {
        // `foo/**`: everything inside foo.
        out += ".*";
        i = end;
      } else {
        // `**/`: zero or more folders. The slash belongs to it.
        out += "(?:.*/)?";
        i = end + 1;
      }
      continue;
    }

    if (c === "?") {
      out += "[^/]";
      i++;
      continue;
    }

    if (c === "[") {
      const bracket = bracketSource(glob, i);
      if (bracket === null) return null;
      out += bracket.source;
      i = bracket.end;
      continue;
    }

    if (c === "\\" && i + 1 < glob.length) {
      out += escapeRegExp(glob[i + 1]);
      i += 2;
      continue;
    }

    out += escapeRegExp(c);
    i++;
  }
  return out;
}

// A `[...]` set starting at `start`. Null when it never closes — git then
// matches nothing at all with the pattern — or when it holds a POSIX class
// such as [[:digit:]], which is not supported.
function bracketSource(
  glob: string,
  start: number,
): { source: string; end: number } | null {
  let i = start + 1;
  const negated = glob[i] === "!" || glob[i] === "^";
  if (negated) i++;

  let body = "";
  // A "]" right after the opening is part of the set, not its end.
  let first = true;
  while (i < glob.length && (glob[i] !== "]" || first)) {
    first = false;
    if (glob.startsWith("[:", i)) return null;

    let low = glob[i];
    if (low === "\\" && i + 1 < glob.length) low = glob[++i];

    if (glob[i + 1] === "-" && i + 2 < glob.length && glob[i + 2] !== "]") {
      let high = glob[i + 2];
      let next = i + 3;
      if (high === "\\" && next < glob.length) high = glob[next++];
      body += `${escapeClass(low)}-${escapeClass(high)}`;
      i = next;
    } else {
      body += escapeClass(low);
      i++;
    }
  }
  if (i >= glob.length) return null;

  // Like `*` and `?`, a set never matches the folder separator.
  return {
    source: negated ? `[^/${body}]` : `(?!/)[${body}]`,
    end: i + 1,
  };
}

function escapeRegExp(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function escapeClass(c: string): string {
  return /[\\\]\[^-]/.test(c) ? `\\${c}` : c;
}
