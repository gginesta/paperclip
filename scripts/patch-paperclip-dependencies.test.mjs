import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./patch-paperclip-dependencies.mjs", import.meta.url));

function fixture(version = "2026.824.0") {
  const root = mkdtempSync(join(tmpdir(), "paperclip-dependency-patch-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "paperclipai", version, dependencies: {} }));
  return root;
}

test("pins and verifies the patched undici resolution", () => {
  const root = fixture();
  assert.match(execFileSync(process.execPath, [script, "--root", root], { encoding: "utf8" }), /PATCH_OK/);
  assert.match(execFileSync(process.execPath, [script, "--root", root], { encoding: "utf8" }), /PATCH_OK/);
  const undici = join(root, "node_modules", "undici");
  const jsdom = join(root, "node_modules", "jsdom");
  const jsdomUndici = join(jsdom, "node_modules", "undici");
  mkdirSync(undici, { recursive: true });
  mkdirSync(jsdomUndici, { recursive: true });
  writeFileSync(join(undici, "package.json"), JSON.stringify({ name: "undici", version: "6.28.0" }));
  writeFileSync(join(jsdom, "package.json"), JSON.stringify({ name: "jsdom", version: "28.1.0" }));
  writeFileSync(join(jsdomUndici, "package.json"), JSON.stringify({ name: "undici", version: "7.29.0" }));
  assert.match(execFileSync(process.execPath, [script, "--root", root, "--verify"], { encoding: "utf8" }), /VERIFY_OK/);
  const marker = JSON.parse(readFileSync(join(root, ".molty-security-dependency-patch.json"), "utf8"));
  assert.equal(marker.verified, true);
});

test("fails closed on version drift", () => {
  const root = fixture("2026.825.0");
  const result = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected paperclipai 2026\.824\.0/);
});
