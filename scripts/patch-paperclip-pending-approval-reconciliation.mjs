#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PATCH_ID = "molty-paperclip-pending-approval-reconciliation-2026-08-27-v1";
const SUPPORTED_VERSION = "2026.824.0";
const PATCH_MARKER = "// molty-skip-pending-approval-built-in-reconcile-v1";
const RECONCILIATION_ANCHOR = `        seen.add(instanceKey);
        try {
            await svc.reconcileDefinitionDefaults(row.companyId, marker.key);`;
const RECONCILIATION_PATCH = `        seen.add(instanceKey);
        ${PATCH_MARKER}
        if (row.status === "pending_approval")
            continue;
        try {
            await svc.reconcileDefinitionDefaults(row.companyId, marker.key);`;

function fail(message) {
  throw new Error(`${PATCH_ID}: ${message}`);
}

function parseArgs() {
  const rootIndex = process.argv.indexOf("--root");
  if (rootIndex === -1 || !process.argv[rootIndex + 1]) {
    fail("usage: patch-paperclip-pending-approval-reconciliation.mjs --root <package-root> [--verify]");
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
    fail(`patched built-in agent service is not valid JavaScript: ${detail}`);
  }
}

const { root, verify } = parseArgs();
const packageJson = readJson(join(root, "package.json"), "paperclip package.json");
const serverRoot = join(root, "node_modules", "@paperclipai", "server");
const serverPackageJson = readJson(join(serverRoot, "package.json"), "server package.json");
const serviceFile = join(serverRoot, "dist", "services", "built-in-agents.js");
const markerFile = join(root, ".molty-pending-approval-reconciliation-patch.json");

if (packageJson.name !== "paperclipai" || packageJson.version !== SUPPORTED_VERSION) {
  fail(`expected paperclipai ${SUPPORTED_VERSION}, found ${packageJson.name ?? "unknown"} ${packageJson.version ?? "unknown"}`);
}
if (serverPackageJson.name !== "@paperclipai/server" || serverPackageJson.version !== SUPPORTED_VERSION) {
  fail(`expected @paperclipai/server ${SUPPORTED_VERSION}, found ${serverPackageJson.name ?? "unknown"} ${serverPackageJson.version ?? "unknown"}`);
}
if (!existsSync(serviceFile)) fail(`missing compiled built-in agent service at ${serviceFile}`);

const serviceSource = readFileSync(serviceFile, "utf8");
if (verify) {
  const marker = readJson(markerFile, "pending-approval reconciliation marker");
  if (marker.patchId !== PATCH_ID || marker.version !== SUPPORTED_VERSION || marker.verified !== true) {
    fail("pending-approval reconciliation marker does not match the supported patch");
  }
  if (count(serviceSource, PATCH_MARKER) !== 1 || count(serviceSource, 'if (row.status === "pending_approval")') !== 1) {
    fail("compiled built-in agent service is missing the exact pending-approval reconciliation guard");
  }
  if (count(serviceSource, "await svc.reconcileDefinitionDefaults(row.companyId, marker.key);") !== 1) {
    fail("compiled built-in agent service reconciliation call drifted");
  }
  verifyJavaScriptSyntax(serviceFile);
  console.log(`PAPERCLIP_PENDING_APPROVAL_RECONCILIATION_VERIFY_OK root=${root}`);
  process.exit(0);
}

if (serviceSource.includes(PATCH_MARKER)) {
  fail("compiled built-in agent service is already patched; run with --verify");
}
if (count(serviceSource, RECONCILIATION_ANCHOR) !== 1) {
  fail(`compiled built-in agent reconciliation anchor drift (expected exactly one match, found ${count(serviceSource, RECONCILIATION_ANCHOR)})`);
}
if (!serviceSource.includes("status: agents.status")) {
  fail("compiled built-in agent startup query does not select agent status");
}

writeAtomic(serviceFile, serviceSource.replace(RECONCILIATION_ANCHOR, RECONCILIATION_PATCH));
verifyJavaScriptSyntax(serviceFile);
writeAtomic(markerFile, `${JSON.stringify({
  patchId: PATCH_ID,
  package: packageJson.name,
  version: packageJson.version,
  verified: true,
}, null, 2)}\n`);
console.log(`PAPERCLIP_PENDING_APPROVAL_RECONCILIATION_PATCH_OK root=${root}`);
