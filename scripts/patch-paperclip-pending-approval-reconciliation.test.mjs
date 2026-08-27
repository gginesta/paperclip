import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./patch-paperclip-pending-approval-reconciliation.mjs", import.meta.url));
const anchor = `        seen.add(instanceKey);
        try {
            await svc.reconcileDefinitionDefaults(row.companyId, marker.key);`;

function fixture(version = "2026.824.0", source = null) {
  const root = mkdtempSync(join(tmpdir(), "paperclip-pending-approval-reconciliation-"));
  const serverRoot = join(root, "node_modules", "@paperclipai", "server");
  mkdirSync(join(serverRoot, "dist", "services"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "paperclipai", version }));
  writeFileSync(join(serverRoot, "package.json"), JSON.stringify({ name: "@paperclipai/server", version }));
  writeFileSync(
    join(serverRoot, "dist", "services", "built-in-agents.js"),
    source ?? `async function reconcileBuiltInAgentsOnStartup(db) {
const rows = await db.select({ status: agents.status });
for (const row of rows) {
${anchor}
            reconciled += 1;
        }
        catch (err) {
            companyFailures += 1;
        }
}
}
`,
  );
  return root;
}

test("skips only pending-approval built-ins before default reconciliation", () => {
  const root = fixture();
  assert.match(execFileSync(process.execPath, [script, "--root", root], { encoding: "utf8" }), /PATCH_OK/);
  assert.match(execFileSync(process.execPath, [script, "--root", root, "--verify"], { encoding: "utf8" }), /VERIFY_OK/);
  const patched = readFileSync(
    join(root, "node_modules", "@paperclipai", "server", "dist", "services", "built-in-agents.js"),
    "utf8",
  );
  assert.match(patched, /if \(row\.status === "pending_approval"\)\n\s+continue;\n\s+try \{\n\s+await svc\.reconcileDefinitionDefaults/);
  assert.equal((patched.match(/await svc\.reconcileDefinitionDefaults/g) ?? []).length, 1);
});

test("fails closed on package version drift", () => {
  const root = fixture("2026.825.0");
  const result = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected paperclipai 2026\.824\.0/);
});

test("fails closed on compiled reconciliation anchor drift", () => {
  const root = fixture("2026.824.0", "const rows = await db.select({ status: agents.status });\n");
  const result = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /anchor drift/);
});
