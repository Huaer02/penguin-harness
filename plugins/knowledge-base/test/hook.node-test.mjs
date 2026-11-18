/** Long tasks create review work; short tasks and agents without the plugin do not. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
const hook = new URL("../hooks/stop.mjs", import.meta.url);
async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "kb-hook-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function invoke(root, turns, installed = true) {
  const state = path.join(root, "agent_state");
  if (installed) {
    await mkdir(path.join(state, "skills", "knowledge-base"), { recursive: true });
    await writeFile(path.join(state, "skills", "knowledge-base", "SKILL.md"), "knowledge");
  }
  const trace = path.join(root, "trace.jsonl");
  const records = [
    { type: "session_meta", payload: { agent_state: state } },
    { type: "model_msg", payload: { type: "text", role: "user", text: "Investigate the build." } },
    ...Array.from({ length: turns }, () => ({
      type: "event_msg",
      payload: { type: "request_end", status: "completed" },
    })),
    {
      type: "model_msg",
      payload: { type: "text", role: "assistant", text: "The tested runtime is Node 24." },
    },
  ];
  await writeFile(trace, records.map((r) => JSON.stringify(r)).join("\n"));
  const result = spawnSync(process.execPath, [hook.pathname], {
    input: JSON.stringify({ session_id: "parent-session", trace_path: trace }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
test("a long task delegates proposal creation and never instructs direct ingestion", () =>
  fixture(async (root) => {
    const result = JSON.parse(await invoke(root, 31));
    assert.equal(result.output.turns, 31);
    assert.match(result.subagent.prompt, /kb_propose/);
    assert.match(result.subagent.prompt, /pending human review/);
    assert.match(result.subagent.prompt, /Do not use kb_ingest/);
    assert.match(result.subagent.prompt, /parent-session/);
  }));
test("a short task does not start background extraction", () =>
  fixture(async (root) => {
    assert.equal(await invoke(root, 30), "");
  }));
test("an agent without the plugin does not start background extraction", () =>
  fixture(async (root) => {
    assert.equal(await invoke(root, 31, false), "");
  }));
