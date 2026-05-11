import { describe, expect, it } from "vitest";
import { buildOpenClawAgentParams, resolveSessionKey } from "./execute.js";

describe("resolveSessionKey", () => {
  it("prefixes run-scoped session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "run",
        configuredSessionKey: null,
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip:run:run-123");
  });

  it("prefixes issue-scoped session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "issue",
        configuredSessionKey: null,
        agentId: "meridian",
        runId: "run-123",
        issueId: "issue-456",
      }),
    ).toBe("agent:meridian:paperclip:issue:issue-456");
  });

  it("prefixes fixed session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "fixed",
        configuredSessionKey: "paperclip",
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip");
  });

  it("does not double-prefix an already-routed session key", () => {
    expect(
      resolveSessionKey({
        strategy: "fixed",
        configuredSessionKey: "agent:meridian:paperclip",
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip");
  });
});

describe("buildOpenClawAgentParams", () => {
  it("does not send Paperclip context as an unsupported top-level OpenClaw agent param", () => {
    const params = buildOpenClawAgentParams({
      payloadTemplate: {
        text: "legacy text",
        paperclip: { issueId: "issue-123" },
      },
      message: "wake text includes Paperclip context",
      sessionKey: "agent:meridian:paperclip:issue:issue-123",
      runId: "run-123",
      configuredAgentId: "meridian",
      waitTimeoutMs: 120000,
    });

    expect(params).toEqual({
      message: "wake text includes Paperclip context",
      sessionKey: "agent:meridian:paperclip:issue:issue-123",
      idempotencyKey: "run-123",
      agentId: "meridian",
      timeout: 120000,
    });
    expect(params).not.toHaveProperty("paperclip");
    expect(params).not.toHaveProperty("text");
  });
});
