import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./patch-paperclip-agent-run-binding.mjs", import.meta.url));
const anchor = "        const responsibleUserId = normalizeOptionalString(key.responsibleUserId);";

function fixture(version = "2026.817.0", authSource) {
  const root = mkdtempSync(join(tmpdir(), "paperclip-agent-run-binding-"));
  const serverRoot = join(root, "node_modules", "@paperclipai", "server");
  mkdirSync(join(serverRoot, "dist", "middleware"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "paperclipai", version }));
  writeFileSync(join(serverRoot, "package.json"), JSON.stringify({ name: "@paperclipai/server", version }));
  writeFileSync(
    join(serverRoot, "dist", "middleware", "auth.js"),
    authSource ?? `import { heartbeatRuns } from "@paperclipai/db";\nfunction normalizeOptionalString(value) { return value; }\n${anchor}\n`,
  );
  return root;
}

test("binds agent-key run ids to the authenticated agent and company", () => {
  const root = fixture();
  assert.match(execFileSync(process.execPath, [script, "--root", root], { encoding: "utf8" }), /PATCH_OK/);
  assert.match(execFileSync(process.execPath, [script, "--root", root, "--verify"], { encoding: "utf8" }), /VERIFY_OK/);
  const patched = readFileSync(join(root, "node_modules", "@paperclipai", "server", "dist", "middleware", "auth.js"), "utf8");
  assert.match(patched, /heartbeatRuns\.companyId, key\.companyId/);
  assert.match(patched, /heartbeatRuns\.agentId, key\.agentId/);
  assert.match(patched, /agent_key_run_identity_mismatch/);
  assert.doesNotMatch(patched, /^\+/m);
});

test("fails closed on package version drift", () => {
  const root = fixture("2026.818.0");
  const result = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected paperclipai 2026\.817\.0/);
});

test("fails closed on compiled middleware anchor drift", () => {
  const root = fixture("2026.817.0", 'import { heartbeatRuns } from "@paperclipai/db";\nfunction normalizeOptionalString(value) { return value; }\n');
  const result = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /anchor drift/);
});
