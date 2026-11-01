// Stand-ins for the claude and codex commands: they print each one's JSON
// lines, and call ZParen's MCP server the way the real agents do.
import { readFileSync } from "node:fs";

export const prompt = () => readFileSync(0, "utf8");

export const print = (line) => process.stdout.write(`${JSON.stringify(line)}\n`);

/** The form the agent evaluates for `text`: a long sleep that records whether it unwound, or six times seven. */
export const formFor = (text) => (text.includes("Sleep a while") ? "(unwind-protect (sleep 30) (defparameter cl-user::*unwound* t))" : "(* 6 7)");

/** What the reply says about the agent's own conversation, for the test to read. */
export const note = (name, resumed, text) =>
  `${name} says **42** (${resumed ? "resumed" : "new"})${text.includes("Earlier in this conversation") ? " and knows the earlier turns" : ""}.`;

export async function callTool(url, headers, form) {
  const r = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "eval", arguments: { form } } }),
  });
  const { result } = await r.json();
  return { text: result.content.map((c) => c.text).join("\n"), isError: result.isError };
}
