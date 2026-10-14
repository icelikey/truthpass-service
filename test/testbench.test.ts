import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import test from "node:test";

test("contract testbench inline JavaScript parses before browser acceptance", async () => {
  const html = await readFile(new URL("../testbench/agent-contracts.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0, "contract testbench must contain its interactive script");
  for (const [, source] of scripts) {
    assert.doesNotThrow(() => new Script(source, { filename: "agent-contracts.html" }));
  }
});
