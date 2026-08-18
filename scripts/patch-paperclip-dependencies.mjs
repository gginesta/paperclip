#!/usr/bin/env node

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PATCH_ID = "molty-paperclip-security-dependencies-2026-08-18-v2";
const SUPPORTED_VERSION = "2026.817.0";
const UNDICI_VERSION = "6.28.0";
const JSDOM_VERSION = "28.1.0";
const JSDOM_UNDICI_VERSION = "7.29.0";

function fail(message) {
  throw new Error(`${PATCH_ID}: ${message}`);
}

function parseArgs() {
  const rootIndex = process.argv.indexOf("--root");
  if (rootIndex === -1 || !process.argv[rootIndex + 1]) {
    fail("usage: patch-paperclip-dependencies.mjs --root <package-root> [--verify]");
  }
  return { root: process.argv[rootIndex + 1], verify: process.argv.includes("--verify") };
}

function readJson(file, label) {
  if (!existsSync(file)) fail(`missing ${label} at ${file}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
  renameSync(temp, file);
}

const { root, verify } = parseArgs();
const packageFile = join(root, "package.json");
const markerFile = join(root, ".molty-security-dependency-patch.json");
const packageJson = readJson(packageFile, "package.json");
if (packageJson.name !== "paperclipai" || packageJson.version !== SUPPORTED_VERSION) {
  fail(`expected paperclipai ${SUPPORTED_VERSION}, found ${packageJson.name ?? "unknown"} ${packageJson.version ?? "unknown"}`);
}

if (!verify) {
  packageJson.overrides ??= {};
  const current = packageJson.overrides["@connectrpc/connect-node"];
  if (current !== undefined && JSON.stringify(current) !== JSON.stringify({ undici: UNDICI_VERSION })) {
    fail(`connect-node override conflict (expected undici ${UNDICI_VERSION})`);
  }
  packageJson.overrides["@connectrpc/connect-node"] = { undici: UNDICI_VERSION };
  writeJsonAtomic(packageFile, packageJson);
  writeJsonAtomic(markerFile, {
    patchId: PATCH_ID,
    package: packageJson.name,
    version: packageJson.version,
    overrides: { "@connectrpc/connect-node": { undici: UNDICI_VERSION } },
    verified: false,
  });
  console.log(`PAPERCLIP_DEPENDENCY_PATCH_OK root=${root}`);
  process.exit(0);
}

const marker = readJson(markerFile, "security dependency marker");
const undici = readJson(join(root, "node_modules", "undici", "package.json"), "undici package");
const jsdom = readJson(join(root, "node_modules", "jsdom", "package.json"), "jsdom package");
const jsdomUndici = readJson(join(root, "node_modules", "jsdom", "node_modules", "undici", "package.json"), "jsdom undici package");
if (marker.patchId !== PATCH_ID || marker.version !== SUPPORTED_VERSION) {
  fail("security dependency marker does not match the supported patch");
}
if (undici.version !== UNDICI_VERSION) {
  fail(`undici effective version mismatch (expected ${UNDICI_VERSION}, found ${undici.version ?? "unknown"})`);
}
if (jsdom.version !== JSDOM_VERSION || jsdomUndici.version !== JSDOM_UNDICI_VERSION) {
  fail(`jsdom compatibility mismatch (expected ${JSDOM_VERSION} with undici ${JSDOM_UNDICI_VERSION}, found ${jsdom.version ?? "unknown"} with ${jsdomUndici.version ?? "unknown"})`);
}
marker.verified = true;
marker.effective = {
  "@connectrpc/connect-node > undici": UNDICI_VERSION,
  jsdom: JSDOM_VERSION,
  "jsdom > undici": JSDOM_UNDICI_VERSION,
};
writeJsonAtomic(markerFile, marker);
console.log(`PAPERCLIP_DEPENDENCY_VERIFY_OK root=${root}`);
