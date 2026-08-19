#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PATCH_ID = "molty-paperclip-openclaw-run-identity-2026-08-19-v2";
const SUPPORTED_VERSION = "2026.817.0";
const INSERT_BEFORE = "        const responsibleUserId = normalizeOptionalString(key.responsibleUserId);";
const PATCH_MARKER = "// molty-agent-key-run-binding-v2";
const PATCH_CODE = `        ${PATCH_MARKER}\n        const normalizedAgentKeyRunId = normalizeOptionalString(runIdHeader);\n        if (normalizedAgentKeyRunId) {\n            const boundRun = await db\n                .select({ id: heartbeatRuns.id })\n                .from(heartbeatRuns)\n                .where(and(eq(heartbeatRuns.id, normalizedAgentKeyRunId), eq(heartbeatRuns.companyId, key.companyId), eq(heartbeatRuns.agentId, key.agentId)))\n                .then((rows) => rows[0] ?? null);\n            if (!boundRun) {\n                next(forbidden("X-Paperclip-Run-Id does not belong to the authenticated agent and company", {\n                    code: "agent_key_run_identity_mismatch",\n                }));\n                return;\n            }\n        }\n`;
const JWT_RUN_MARKER = "// molty-openclaw-active-run-jwt-v2";
const JWT_RUN_ANCHOR = "            const onBehalfOfUserId = claims.responsible_user_id !== undefined";
const JWT_RUN_PATCH = `            ${JWT_RUN_MARKER}\n            const activeJwtRun = await db\n                .select({ id: heartbeatRuns.id })\n                .from(heartbeatRuns)\n                .where(and(eq(heartbeatRuns.id, claims.run_id), eq(heartbeatRuns.companyId, claims.company_id), eq(heartbeatRuns.agentId, claims.sub), eq(heartbeatRuns.status, "in_progress")))\n                .then((rows) => rows[0] ?? null);\n            if (!activeJwtRun) {\n                next(forbidden("Signed agent JWT is not bound to an active run", { code: "agent_jwt_run_inactive" }));\n                return;\n            }\n`;
const REGISTRY_MARKER = "// molty-openclaw-run-jwt-v2";
const OPENCLAW_REGISTRY_ANCHOR = `const openclawGatewayAdapter = {\n    type: "openclaw_gateway",\n    execute: openclawGatewayExecute,\n    testEnvironment: openclawGatewayTestEnvironment,\n    models: openclawGatewayModels,\n    supportsLocalAgentJwt: false,`;
const OPENCLAW_REGISTRY_PATCH = `const openclawGatewayAdapter = {\n    type: "openclaw_gateway",\n    execute: openclawGatewayExecute,\n    testEnvironment: openclawGatewayTestEnvironment,\n    models: openclawGatewayModels,\n    ${REGISTRY_MARKER}\n    supportsLocalAgentJwt: true,`;
const WAKE_SIGNATURE_ANCHOR = "function buildWakeText(payload, paperclipEnv, structuredWakePrompt, claimedApiKeyPath) {";
const WAKE_SIGNATURE_PATCH = "function buildWakeText(payload, paperclipEnv, structuredWakePrompt, claimedApiKeyPath, runScopedApiToken) {";
const WAKE_CREDENTIAL_ANCHOR = `        ...envLines,\n        \`PAPERCLIP_API_KEY=<token from \${claimedApiKeyPath}>\`,\n        "",\n        \`Load PAPERCLIP_API_KEY from \${claimedApiKeyPath} (the token you saved after claim-api-key).\`,\n        "",`;
const WAKE_CREDENTIAL_PATCH = `        ...envLines,\n        ...(runScopedApiToken\n            ? [\`PAPERCLIP_API_KEY=\${runScopedApiToken}\`, "", "Use this injected run-scoped Paperclip token. Do not load or substitute any persistent claimed API key file for this wake."]\n            : [\`PAPERCLIP_API_KEY=<token from \${claimedApiKeyPath}>\`, "", \`Load PAPERCLIP_API_KEY from \${claimedApiKeyPath} (the token you saved after claim-api-key).\`]),\n        "",`;
const WAKE_CALL_ANCHOR = "        : structuredWakePrompt, resolveClaimedApiKeyPath(ctx.config.claimedApiKeyPath));";
const WAKE_CALL_PATCH = "        : structuredWakePrompt, resolveClaimedApiKeyPath(ctx.config.claimedApiKeyPath), ctx.authToken ?? null);";
const LOG_REDACTION_ANCHOR = "        return truncateForLog(value);";
const LOG_REDACTION_PATCH = "        return truncateForLog(value.replace(/PAPERCLIP_API_KEY=[^\\s]+/g, \"PAPERCLIP_API_KEY=[redacted-run-token]\"));";

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
const registryFile = join(serverRoot, "dist", "adapters", "registry.js");
const openclawFile = join(root, "node_modules", "@paperclipai", "adapter-openclaw-gateway", "dist", "server", "execute.js");
const markerFile = join(root, ".molty-agent-key-run-binding-patch.json");

if (packageJson.name !== "paperclipai" || packageJson.version !== SUPPORTED_VERSION) {
  fail(`expected paperclipai ${SUPPORTED_VERSION}, found ${packageJson.name ?? "unknown"} ${packageJson.version ?? "unknown"}`);
}
if (serverPackageJson.name !== "@paperclipai/server" || serverPackageJson.version !== SUPPORTED_VERSION) {
  fail(`expected @paperclipai/server ${SUPPORTED_VERSION}, found ${serverPackageJson.name ?? "unknown"} ${serverPackageJson.version ?? "unknown"}`);
}
if (!existsSync(authFile)) fail(`missing compiled auth middleware at ${authFile}`);
if (!existsSync(registryFile)) fail(`missing compiled adapter registry at ${registryFile}`);
if (!existsSync(openclawFile)) fail(`missing compiled OpenClaw adapter at ${openclawFile}`);

const authSource = readFileSync(authFile, "utf8");
const registrySource = readFileSync(registryFile, "utf8");
const openclawSource = readFileSync(openclawFile, "utf8");
if (verify) {
  const marker = readJson(markerFile, "agent run-binding marker");
  if (marker.patchId !== PATCH_ID || marker.version !== SUPPORTED_VERSION || marker.verified !== true) {
    fail("agent run-binding marker does not match the supported patch");
  }
  if (count(authSource, PATCH_MARKER) !== 1 || !authSource.includes("agent_key_run_identity_mismatch")) {
    fail("compiled auth middleware is missing the exact agent run-binding patch");
  }
  if (count(authSource, JWT_RUN_MARKER) !== 1 || !authSource.includes("agent_jwt_run_inactive")) {
    fail("compiled auth middleware is missing active run validation for signed agent JWTs");
  }
  if (count(registrySource, REGISTRY_MARKER) !== 1 || !registrySource.includes("supportsLocalAgentJwt: true")) {
    fail("compiled adapter registry is missing OpenClaw run-JWT enablement");
  }
  if (count(openclawSource, "Use this injected run-scoped Paperclip token") !== 1 || !openclawSource.includes("ctx.authToken ?? null") || !openclawSource.includes("[redacted-run-token]")) {
    fail("compiled OpenClaw adapter is missing run-scoped token injection");
  }
  verifyJavaScriptSyntax(authFile);
  verifyJavaScriptSyntax(registryFile);
  verifyJavaScriptSyntax(openclawFile);
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
if (count(authSource, JWT_RUN_ANCHOR) !== 1) {
  fail(`compiled auth middleware JWT anchor drift (expected exactly one match, found ${count(authSource, JWT_RUN_ANCHOR)})`);
}
if (count(registrySource, OPENCLAW_REGISTRY_ANCHOR) !== 1) {
  fail(`compiled adapter registry anchor drift (expected exactly one match, found ${count(registrySource, OPENCLAW_REGISTRY_ANCHOR)})`);
}
for (const [label, anchor] of [["wake signature", WAKE_SIGNATURE_ANCHOR], ["wake credentials", WAKE_CREDENTIAL_ANCHOR], ["wake call", WAKE_CALL_ANCHOR]]) {
  if (count(openclawSource, anchor) !== 1) fail(`compiled OpenClaw adapter ${label} anchor drift (expected exactly one match, found ${count(openclawSource, anchor)})`);
}
if (count(openclawSource, LOG_REDACTION_ANCHOR) !== 1) {
  fail(`compiled OpenClaw adapter log-redaction anchor drift (expected exactly one match, found ${count(openclawSource, LOG_REDACTION_ANCHOR)})`);
}

writeAtomic(authFile, authSource
  .replace(JWT_RUN_ANCHOR, `${JWT_RUN_PATCH}${JWT_RUN_ANCHOR}`)
  .replace(INSERT_BEFORE, `${PATCH_CODE}${INSERT_BEFORE}`));
writeAtomic(registryFile, registrySource.replace(OPENCLAW_REGISTRY_ANCHOR, OPENCLAW_REGISTRY_PATCH));
writeAtomic(openclawFile, openclawSource
  .replace(WAKE_SIGNATURE_ANCHOR, WAKE_SIGNATURE_PATCH)
  .replace(WAKE_CREDENTIAL_ANCHOR, WAKE_CREDENTIAL_PATCH)
  .replace(WAKE_CALL_ANCHOR, WAKE_CALL_PATCH)
  .replace(LOG_REDACTION_ANCHOR, LOG_REDACTION_PATCH));
verifyJavaScriptSyntax(authFile);
verifyJavaScriptSyntax(registryFile);
verifyJavaScriptSyntax(openclawFile);
writeAtomic(markerFile, `${JSON.stringify({ patchId: PATCH_ID, package: packageJson.name, version: packageJson.version, verified: true }, null, 2)}\n`);
console.log(`PAPERCLIP_AGENT_RUN_BINDING_PATCH_OK root=${root}`);
