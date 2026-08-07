const UUID = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const MARKER = new RegExp(`<!-- kanon-comment:(${UUID}) -->`, "g");
const MARKER_SHAPE = new RegExp(`<!-- kanon-comment:${UUID} -->`);
const FINAL_MARKER = new RegExp(`^(.*?)(?:\\n\\n)?(<!-- kanon-comment:(${UUID}) -->)$`, "s");

export type ParsedCommentMarker = {
  readonly commentId: string;
  readonly marker: string;
  readonly body: string;
};

/** Parses the single canonical marker Redmine appends after a comment body. */
export function parseCommentMarker(value: string): ParsedCommentMarker | null {
  const matches = [...value.matchAll(MARKER)];
  if (matches.length !== 1) return null;

  const final = value.match(FINAL_MARKER);
  if (!final || final[2] !== matches[0]![0]) return null;

  return { body: final[1]!, marker: final[2]!, commentId: final[3]! };
}

/** Local comment bodies must not contain transport-reserved marker syntax. */
export function hasReservedCommentMarker(value: string): boolean {
  return MARKER_SHAPE.test(value);
}
