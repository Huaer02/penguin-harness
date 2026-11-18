import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BuiltinTool, ControlEnvContext } from "@prismshadow/penguin-core";
import { partialToolCallOutput } from "@prismshadow/amsp/records";
import {
  KnowledgeContent,
  environmentEmbedding,
} from "@penguinharness/knowledge-base/service/content.mjs";

/** The host binds identity once; tool arguments select resources, never identity or paths. */
export function knowledgeTools(root: string, identity: ControlEnvContext): BuiltinTool[] {
  const skill = path.join(
    root,
    identity.projectId,
    "agents",
    identity.agentId,
    "agent_state",
    "skills",
    "knowledge-base",
    "SKILL.md",
  );
  if (!existsSync(skill)) return [];
  const actor = {
    kind: "agent" as const,
    projectId: identity.projectId,
    agentId: identity.agentId,
  };
  const descriptions: Record<string, string> = {
    kb_libraries: "List connected knowledge libraries and contribution permissions.",
    kb_create:
      "Create a Project knowledge library when the owner has granted this agent creation permission. Connects only this agent with reviewed contribution access. Reuse requestId for retries; does not publish documents or grant access to others.",
    kb_ingest:
      "Import requested source text. Authorized direct importers publish immediately; other contributors submit for review. Read files first and preserve the source. Autonomous findings must use kb_propose.",
    kb_ingest_batch:
      "Import up to 50 requested source texts with persistent per-item outcomes. Direct import permission publishes original documents immediately; otherwise they await review. Resubmit failed items only.",
    kb_search:
      "Search explicitly selected connected libraries. Returns versioned citation evidence.",
    kb_get: "Read a citation chunk, including historical source versions.",
    kb_sources: "List current sources in one connected library.",
    kb_propose:
      "Submit a durable finding and evidence for asynchronous human review. Pending findings are not searchable.",
  };
  const fields: Record<string, Record<string, unknown>> = {
    items: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          title: { type: "string" },
          text: { type: "string" },
          error: {
            type: "string",
            description:
              "If source reading failed, record the actual error and use empty text. Do not fabricate document contents.",
          },
        },
        required: ["source", "title", "text"],
      },
    },
    name: { type: "string", minLength: 1, maxLength: 200 },
    requestId: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      description:
        "Stable identifier for this creation request. Reuse on retries, even across Sessions; use a new ID for a different library.",
    },
    libraryId: { type: "string" },
    libraryIds: { type: "array", items: { type: "string" } },
    query: { type: "string" },
    chunkId: { type: "string" },
    source: { type: "string" },
    title: { type: "string" },
    text: { type: "string" },
    taskId: {
      type: "string",
      description: "Stable identifier of the source task, including its source Session ID.",
    },
    conclusion: { type: "string" },
    conditions: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    mode: { type: "string", enum: ["lexical", "semantic", "hybrid"] },
  };
  const required: Record<string, string[]> = {
    kb_libraries: [],
    kb_create: ["name", "requestId"],
    kb_ingest_batch: ["libraryId", "items"],
    kb_ingest: ["libraryId", "source", "title", "text"],
    kb_search: ["libraryIds", "query"],
    kb_get: ["libraryId", "chunkId"],
    kb_sources: ["libraryId"],
    kb_propose: ["libraryId", "taskId", "title", "conclusion", "conditions", "evidence"],
  };
  return Object.entries(descriptions).map(([name, description]) => ({
    name,
    definition: {
      name,
      description,
      permission:
        name === "kb_create" ||
        name === "kb_ingest" ||
        name === "kb_ingest_batch" ||
        name === "kb_propose"
          ? "rw"
          : "r",
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          [...required[name]!, ...(name === "kb_search" ? ["mode"] : [])].map((key) => [
            key,
            fields[key],
          ]),
        ),
        required: required[name],
      },
    },
    async *execute(args, ctx) {
      ctx.signal?.throwIfAborted();
      if (!existsSync(skill)) throw new Error("Knowledge Base plugin is no longer installed");
      const directory = path.join(root, "knowledge-base");
      await mkdir(directory, { recursive: true });
      const store = new KnowledgeContent(
        path.join(directory, "resources.db"),
        () => {
          throw new Error("Agent tools cannot manage or approve knowledge");
        },
        environmentEmbedding(),
      );
      try {
        let result: unknown;
        const libraryId = args.libraryId as string;
        switch (name) {
          case "kb_create":
            result = await store.createForAgent(actor, {
              name: args.name as string,
              requestId: args.requestId as string,
            });
            break;
          case "kb_libraries":
            result = store.list(actor);
            break;
          case "kb_ingest_batch":
            result = await store.importBatch(
              actor,
              libraryId,
              args.items as unknown[],
              identity.sessionId,
            );
            break;
          case "kb_ingest": {
            const batch = await store.importBatch(
              actor,
              libraryId,
              [{ source: args.source, title: args.title, text: args.text }],
              identity.sessionId,
            );
            const item = batch.items[0]!;
            if (item.status === "failed") throw new Error(String(item.error));
            result = { ...(item.result as Record<string, unknown>), status: item.status };
            break;
          }
          case "kb_search":
            result = await store.search(actor, args.libraryIds as string[], args.query as string, {
              mode: args.mode as string | undefined,
            });
            break;
          case "kb_get":
            result = await store.get(actor, libraryId, args.chunkId as string);
            break;
          case "kb_sources":
            result = await store.sources(actor, libraryId);
            break;
          case "kb_propose":
            result = await store.propose(actor, libraryId, {
              taskId: args.taskId as string,
              sessionId: identity.sessionId,
              title: args.title as string,
              conclusion: args.conclusion as string,
              conditions: args.conditions as string,
              evidence: args.evidence as string[],
            });
            break;
        }
        yield partialToolCallOutput({
          eventType: "delta",
          toolCallId: ctx.toolCallId,
          output: JSON.stringify(result),
        });
      } finally {
        store.close();
      }
    },
  }));
}
