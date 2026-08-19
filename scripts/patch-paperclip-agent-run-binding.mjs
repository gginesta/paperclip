#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PATCH_ID = "molty-paperclip-agent-key-run-binding-2026-08-19-v1";
const SUPPORTED_VERSION = "2026.817.0";
const INSERT_BEFORE = "        const responsibleUserId = normalizeOptionalString(key.responsibleUserId);";
const PATCH_MARKER = "// molty-agent-key-run-binding-v1";
const PATCH_CODE = `        ${PATCH_MARKER}\n        const normalizedAgentKeyRunId = normalizeOptionalString(runIdHeader);\n        if (normalizedAgentKeyRunId) {\n            const boundRun = await db\n                .select({ id: heartbeatRuns.id })\n                .from(heartbeatRuns)\n                .where(and(eq(heartbeatRuns.id, normalizedAgentKeyRunId), eq(heartbeatRuns.companyId, key.companyId), eq(heartbeatRuns.agentId, key.agentId)))\n                .then((rows) => rows[0] ?? null);\n            if (!boundRun) {\n                next(forbidden("X-Paperclip-Run-Id does not belong to the authenticated agent and company", {\n                    code: "agent_key_run_identity_mismatch",\n                }));\n                return;\n            }\n        }\n`;

function fail(message) {
  throw new Error(`${PATCH_ID}: ${message}`);
}

function parseArgs() {
  const rootIndex = process.argv.indexOf("--root");
  if (rootIndex === -1 || !process.argv[rootIndex + 1]) {
    fail("usage: patch-paperclip-agent-run-binding.mjs --root <package-root> [--verify]");
  }
  return { root: process.argv[rootIndex + 1], verify: process.argv.includes("--verify") };
}

function readJson(file, label) {
  if (!existsSync(file)) fail(`missing ${label} at ${file}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, value, { mode: 0o644 });
  renameSync(temp, file);
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

function verifyJavaScriptSyntax(file) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    const detail = error?.stderr?.toString?.().trim() || "syntax check failed";
    fail(`patched auth middleware is not valid JavaScript: ${detail}`);
  }
}

const { root, verify } = parseArgs();
const packageJson = readJson(join(root, "package.json"), "paperclip package.json");
const serverRoot = join(root, "node_modules", "@paperclipai", "server");
const serverPackageJson = readJson(join(serverRoot, "package.json"), "server package.json");
const authFile = join(serverRoot, "dist", "middleware", "auth.js");
const markerFile = join(root, ".molty-agent-key-run-binding-patch.json");

if (packageJson.name !== "paperclipai" || packageJson.version !== SUPPORTED_VERSION) {
  fail(`expected paperclipai ${SUPPORTED_VERSION}, found ${packageJson.name ?? "unknown"} ${packageJson.version ?? "unknown"}`);
}
if (serverPackageJson.name !== "@paperclipai/server" || serverPackageJson.version !== SUPPORTED_VERSION) {
  fail(`expected @paperclipai/server ${SUPPORTED_VERSION}, found ${serverPackageJson.name ?? "unknown"} ${serverPackageJson.version ?? "unknown"}`);
}
if (!existsSync(authFile)) fail(`missing compiled auth middleware at ${authFile}`);

const authSource = readFileSync(authFile, "utf8");
if (verify) {
  const marker = readJson(markerFile, "agent run-binding marker");
  if (marker.patchId !== PATCH_ID || marker.version !== SUPPORTED_VERSION || marker.verified !== true) {
    fail("agent run-binding marker does not match the supported patch");
  }
  if (count(authSource, PATCH_MARKER) !== 1 || !authSource.includes("agent_key_run_identity_mismatch")) {
    fail("compiled auth middleware is missing the exact agent run-binding patch");
  }
  verifyJavaScriptSyntax(authFile);
  console.log(`PAPERCLIP_AGENT_RUN_BINDING_VERIFY_OK root=${root}`);
  process.exit(0);
}

if (authSource.includes(PATCH_MARKER)) {
  fail("compiled auth middleware is already patched; run with --verify");
}
if (count(authSource, INSERT_BEFORE) !== 1) {
  fail(`compiled auth middleware anchor drift (expected exactly one match, found ${count(authSource, INSERT_BEFORE)})`);
}
if (!authSource.includes("heartbeatRuns") || !authSource.includes("function normalizeOptionalString")) {
  fail("compiled auth middleware prerequisites are missing");
}

writeAtomic(authFile, authSource.replace(INSERT_BEFORE, `${PATCH_CODE}${INSERT_BEFORE}`));
verifyJavaScriptSyntax(authFile);
writeAtomic(markerFile, `${JSON.stringify({ patchId: PATCH_ID, package: packageJson.name, version: packageJson.version, verified: true }, null, 2)}\n`);
console.log(`PAPERCLIP_AGENT_RUN_BINDING_PATCH_OK root=${root}`);
