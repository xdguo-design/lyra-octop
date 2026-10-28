export type TextDiffLine = { kind: "same" | "added" | "removed"; text: string };

const MAX_DIFF_CELLS = 1_000_000;
const MAX_DIFF_CHARACTERS = 200_000;

export function diffTextLines(
  before: string,
  after: string,
): TextDiffLine[] | null {
  if (before.length + after.length > MAX_DIFF_CHARACTERS) return null;

  const left = before.split("\n");
  const right = after.split("\n");
  if ((left.length + 1) * (right.length + 1) > MAX_DIFF_CELLS) return null;

  const rows = Array.from(
    { length: left.length + 1 },
    () => new Uint32Array(right.length + 1),
  );
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      rows[i][j] =
        left[i] === right[j]
          ? rows[i + 1][j + 1] + 1
          : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }

  const diff: TextDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      diff.push({ kind: "same", text: left[i++] });
      j++;
    } else if (rows[i + 1][j] >= rows[i][j + 1]) {
      diff.push({ kind: "removed", text: left[i++] });
    } else {
      diff.push({ kind: "added", text: right[j++] });
    }
  }
  while (i < left.length) diff.push({ kind: "removed", text: left[i++] });
  while (j < right.length) diff.push({ kind: "added", text: right[j++] });
  return diff;
}
