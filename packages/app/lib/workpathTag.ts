/**
 * Compute short display tags for a list of workpaths.
 *
 * Base rule:
 *   - If the label splits into multiple alphanumeric parts (separators:
 *     anything not [a-z0-9]), take the first character of the first two
 *     parts. `tag-tracing` → `tt`, `app.zalify.com` → `az`.
 *   - If it is a single word of length >= 2, take the first character and
 *     the character at the midpoint: `webmux` (len 6, mid 3) → `wm`,
 *     `z1` (len 2, mid 1) → `z1`.
 *   - If it is a single character, return that character.
 *
 * Collision resolution:
 *   - Two-char tags that collide are retried as three-char tags (same
 *     construction extended by one letter).
 *   - Anything still colliding gets an index-suffixed fallback
 *     (`a0`, `a1`, ...) to guarantee uniqueness.
 *
 * Result is keyed by the caller-supplied stable `id` (not the label) so
 * two workpaths sharing a label (e.g. two bookmarks both named `src`)
 * still get distinct entries instead of one overwriting the other.
 *
 * Deterministic: same input always produces the same output.
 */
export interface WorkpathTagInput {
  id: string;
  label: string;
}

export function computeWorkpathTags(
  inputs: WorkpathTagInput[],
): Record<string, string> {
  const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  const splitParts = (s: string): string[] =>
    s.toLowerCase().split(/[^a-z0-9]+/).filter((p) => p.length > 0);

  const pick = (label: string, n: number): string => {
    const parts = splitParts(label);
    if (parts.length === 0) return "";

    if (parts.length >= 2) {
      // Multi-part: one char per part, up to n parts.
      let out = "";
      for (let i = 0; i < parts.length && out.length < n; i++) {
        out += parts[i][0];
      }
      // If we still need more chars (e.g. only 1 viable part), pad from
      // remaining letters of the first part.
      if (out.length < n) {
        const extra = parts[0].slice(1, 1 + (n - out.length));
        out += extra;
      }
      return out.slice(0, n);
    }

    // Single-part: first char + midpoint char(s).
    const word = parts[0];
    if (word.length <= n) return word; // preserves `z1` verbatim when n=2
    if (n === 1) return word[0];
    // First char plus chars taken from around the midpoint.
    const mid = Math.floor(word.length / 2);
    if (n === 2) return word[0] + word[mid];
    // n === 3: first + mid + last? Take first + mid + last alnum char.
    return word[0] + word[mid] + word[word.length - 1];
  };

  const result: Record<string, string> = {};
  const used = new Set<string>();

  // Pass 1: 2-char tag
  for (const { id, label } of inputs) {
    if (result[id] !== undefined) continue;
    const tag = pick(label, 2);
    if (!tag) continue;
    if (!used.has(tag)) {
      result[id] = tag;
      used.add(tag);
    }
  }

  // Pass 2: anything still missing, try 3-char
  for (const { id, label } of inputs) {
    if (result[id] !== undefined) continue;
    const tag = pick(label, 3);
    if (!tag) continue;
    if (!used.has(tag)) {
      result[id] = tag;
      used.add(tag);
    }
  }

  // Pass 3: still missing — index suffix
  let idx = 0;
  for (const { id, label } of inputs) {
    if (result[id] !== undefined) continue;
    const base = alnum(label).slice(0, 1) || "w";
    let candidate = "";
    do {
      candidate = `${base}${idx}`;
      idx++;
    } while (used.has(candidate));
    result[id] = candidate;
    used.add(candidate);
  }

  return result;
}
