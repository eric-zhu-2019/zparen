/** A tool call's input as people read it: one argument as itself, several as name: value lines. */
export function toolInput(input: string): string {
  let args: unknown;
  try {
    args = JSON.parse(input);
  } catch {
    return input;
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return input;
  const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  const entries = Object.entries(args);
  if (entries.length === 1) return show(entries[0][1]);
  return entries.map(([k, v]) => `${k}: ${show(v)}`).join("\n");
}
