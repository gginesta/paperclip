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
  const openclawRoot = join(root, "node_modules", "@paperclipai", "adapter-openclaw-gateway");
  mkdirSync(join(serverRoot, "dist", "middleware"), { recursive: true });
  mkdirSync(join(serverRoot, "dist", "adapters"), { recursive: true });
  mkdirSync(join(openclawRoot, "dist", "server"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "paperclipai", version }));
  writeFileSync(join(serverRoot, "package.json"), JSON.stringify({ name: "@paperclipai/server", version }));
  writeFileSync(
    join(serverRoot, "dist", "middleware", "auth.js"),
    authSource ?? `import { heartbeatRuns } from "@paperclipai/db";\nfunction normalizeOptionalString(value) { return value; }\n            const onBehalfOfUserId = claims.responsible_user_id !== undefined\n${anchor}\n`,
  );
  writeFileSync(
    join(serverRoot, "dist", "adapters", "registry.js"),
    `const openclawGatewayAdapter = {\n    type: "openclaw_gateway",\n    execute: openclawGatewayExecute,\n    testEnvironment: openclawGatewayTestEnvironment,\n    models: openclawGatewayModels,\n    supportsLocalAgentJwt: false,\n};\n`,
  );
  writeFileSync(
    join(openclawRoot, "dist", "server", "execute.js"),
    `function redactForLog(value) {\n    if (typeof value === "string") {\n        return truncateForLog(value);\n    }\n}\nfunction buildWakeText(payload, paperclipEnv, structuredWakePrompt, claimedApiKeyPath) {\n    const lines = [\n        ...envLines,\n        \`PAPERCLIP_API_KEY=<token from \${claimedApiKeyPath}>\`,\n        "",\n        \`Load PAPERCLIP_API_KEY from \${claimedApiKeyPath} (the token you saved after claim-api-key).\`,\n        "",\n    ];\n}\nconst wakeText = buildWakeText(wakePayload, paperclipEnv, structuredWakeJson\n        ? joinWakePayloadSections(structuredWakePrompt, structuredWakeJson)\n        : structuredWakePrompt, resolveClaimedApiKeyPath(ctx.config.claimedApiKeyPath));\n`,
  );
  return root;
}

test("binds static keys to run identity and injects a signed run token for OpenClaw", () => {
  const root = fixture();
  assert.match(execFileSync(process.execPath, [script, "--root", root], { encoding: "utf8" }), /PATCH_OK/);
  assert.match(execFileSync(process.execPath, [script, "--root", root, "--verify"], { encoding: "utf8" }), /VERIFY_OK/);
  const patched = readFileSync(join(root, "node_modules", "@paperclipai", "server", "dist", "middleware", "auth.js"), "utf8");
  assert.match(patched, /heartbeatRuns\.companyId, key\.companyId/);
  assert.match(patched, /heartbeatRuns\.agentId, key\.agentId/);
  assert.match(patched, /agent_key_run_identity_mismatch/);
  assert.match(patched, /agent_jwt_run_inactive/);
  assert.match(patched, /heartbeatRuns\.status, "running"/);
  assert.doesNotMatch(patched, /^\+/m);
  const registry = readFileSync(join(root, "node_modules", "@paperclipai", "server", "dist", "adapters", "registry.js"), "utf8");
  assert.match(registry, /molty-openclaw-run-jwt-v2/);
  assert.match(registry, /supportsLocalAgentJwt: true/);
  const openclaw = readFileSync(join(root, "node_modules", "@paperclipai", "adapter-openclaw-gateway", "dist", "server", "execute.js"), "utf8");
  assert.match(openclaw, /PAPERCLIP_API_KEY=\$\{runScopedApiToken\}/);
  assert.match(openclaw, /ctx\.authToken \?\? null/);
  assert.match(openclaw, /Do not load or substitute any persistent claimed API key file/);
  assert.match(openclaw, /PAPERCLIP_API_KEY=\[redacted-run-token\]/);
});

test("fails closed on package version drift", () => {
  const root = fixture("2026.818.0");
  const result = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected paperclipai 2026\.817\.0/);
});

test("fails closed on compiled middleware anchor drift", () => {
  const root = fixture("2026.817.0", 'import { heartbeatRuns } from "@paperclipai/db";\nfunction normalizeOptionalString(value) { return value; }\n            const onBehalfOfUserId = claims.responsible_user_id !== undefined\n');
  const result = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /anchor drift/);
});
