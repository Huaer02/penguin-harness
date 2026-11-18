import { existsSync } from "node:fs";
/** Project knowledge management. Authenticated human owners manage resources;
 * agent tool access must use a separate, host-authenticated identity path. */
import { Hono } from "hono";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extractKnowledgeFile } from "../../services/knowledge-files.js";
import path from "node:path";
import {
  KnowledgeContent,
  environmentEmbedding,
} from "@penguinharness/knowledge-base/service/content.mjs";
import { requireHuman } from "../../auth/middleware.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { Access, AgentIndex } from "../../mechanisms/projects.js";
import { HttpError } from "../errors.js";
import { badRequest, pathParam, readJson, requireString, requireValidId } from "../validate.js";

export function knowledgeRoutes(deps: {
  root: string;
  access: Access;
  agents: AgentIndex;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    requireHuman(c);
    deps.access.requireProjectOwner(c.var.user.userId, requireValidId(c, "projectId"));
    await next();
  });
  // Per-request handles close even on errors and do not survive platform hot swaps.
  // The database is host-owned, outside any one Agent State or Workspace.
  async function withStore<T>(run: (store: KnowledgeContent) => Promise<T>): Promise<T> {
    const directory = path.join(deps.root, "knowledge-base");
    await mkdir(directory, { recursive: true });
    const store = new KnowledgeContent(
      path.join(directory, "resources.db"),
      (u, p) => {
        deps.access.requireProjectOwner(u, p);
      },
      environmentEmbedding(),
    );
    try {
      return await run(store);
    } catch (error) {
      if (error instanceof Error && error.message === "knowledge library unavailable") {
        throw new HttpError(404, "knowledge_library_not_found", "Knowledge library unavailable.");
      }
      if (error instanceof Error && /unavailable$/.test(error.message))
        throw new HttpError(404, "knowledge_item_not_found", error.message);
      if (
        error instanceof Error &&
        /conflict|already reviewed|restore requires/.test(error.message)
      )
        throw new HttpError(409, "knowledge_conflict", error.message);
      if (error instanceof Error && error.message.startsWith("Only the original submitter"))
        throw new HttpError(403, "knowledge_retry_forbidden", error.message);
      if (error instanceof Error && /must contain|must be non-empty|exceeds/.test(error.message))
        throw badRequest(error.message);
      if (error instanceof Error && /^(invalid |batch |library archived)/.test(error.message))
        throw badRequest(error.message);
      if (error instanceof Error && error.message === "candidate already reviewed")
        throw new HttpError(409, "candidate_reviewed", error.message);
      throw error;
    } finally {
      store.close();
    }
  }
  const actor = (c: {
    var: AppEnv["Variables"];
    req: { param(name: string): string | undefined };
  }) => ({
    kind: "user" as const,
    userId: c.var.user.userId,
    projectId: c.req.param("projectId")!,
  });

  // Keep earlier bookmarks usable while directing users to the native plugin entry.
  app.get("/manage", (c) => {
    const projectId = requireValidId(c, "projectId");
    const agent = deps.agents
      .list(projectId)
      .find(({ agentId }) =>
        existsSync(
          path.join(
            deps.root,
            projectId,
            "agents",
            agentId,
            "agent_state",
            "workbenches",
            "knowledge-base",
            "package.json",
          ),
        ),
      );
    if (agent && c.req.query("library") && c.req.query("chunk")) {
      const params = new URLSearchParams({
        library: c.req.query("library")!,
        chunk: c.req.query("chunk")!,
      });
      return c.redirect(
        `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agent.agentId)}/workbenches/knowledge-base/ui/index.html?${params}`,
      );
    }
    if (agent)
      return c.redirect(
        `/app/${encodeURIComponent(projectId)}/${encodeURIComponent(agent.agentId)}/knowledge-base`,
      );
    return c.html(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>知识库</title><body><h1>知识库</h1><p>请在插件市场将知识库安装或更新到当前 Agent，然后从应用中心打开。</p><a href="/plugins">打开插件市场 / Open plugin marketplace</a></body></html>',
    );
  });
  app.get("/", async (c) => c.json({ libraries: await withStore((s) => s.listManaged(actor(c))) }));
  app.post("/", async (c) => {
    const body = await readJson(c);
    const name = requireString(body, "name", { minLen: 1, maxLen: 200 });
    return c.json({ library: await withStore((s) => s.create(actor(c), name)) }, 201);
  });
  const permissionAgent = (c: Parameters<typeof requireValidId>[0]) => {
    const agentId = requireValidId(c, "agentId");
    if (!deps.agents.exists(requireValidId(c, "projectId"), agentId))
      throw new HttpError(404, "agent_not_found", "Agent unavailable.");
    return agentId;
  };
  app.get("/creation-permissions/:agentId", async (c) => {
    const agentId = permissionAgent(c);
    return c.json(await withStore((s) => s.creationPermission(actor(c), agentId)));
  });
  app.put("/creation-permissions/:agentId", async (c) => {
    const agentId = permissionAgent(c);
    const body = await readJson(c);
    if (typeof body.allowed !== "boolean") throw badRequest("allowed must be boolean.");
    return c.json(
      await withStore((s) => s.setCreationPermission(actor(c), agentId, body.allowed as boolean)),
    );
  });
  app.get("/import-permissions/:agentId", async (c) => {
    const agentId = permissionAgent(c);
    return c.json(await withStore((s) => s.importPermission(actor(c), agentId)));
  });
  app.put("/import-permissions/:agentId", async (c) => {
    const agentId = permissionAgent(c);
    const body = await readJson(c);
    if (typeof body.allowed !== "boolean") throw badRequest("allowed must be boolean.");
    return c.json(
      await withStore((s) => s.setImportPermission(actor(c), agentId, body.allowed as boolean)),
    );
  });
  app.get("/backup", async (c) => c.json(await withStore((s) => s.backup(actor(c)))));
  app.post("/restore", async (c) => {
    const backup = await readJson(c);
    return c.json(
      await withStore((s) =>
        s.restore(actor(c), backup, (id) => deps.agents.exists(actor(c).projectId, id)),
      ),
    );
  });
  app.put("/:libraryId", async (c) => {
    const body = await readJson(c);
    const patch: { name?: string; description?: string; archived?: boolean; shared?: boolean } = {};
    if (body.name !== undefined)
      patch.name = requireString(body, "name", { minLen: 1, maxLen: 200 });
    if (body.description !== undefined) {
      if (typeof body.description !== "string" || body.description.length > 2000)
        throw badRequest("invalid description");
      patch.description = body.description;
    }
    if (body.shared !== undefined) {
      if (typeof body.shared !== "boolean") throw badRequest("invalid shared");
      patch.shared = body.shared;
    }
    if (body.archived !== undefined) {
      if (typeof body.archived !== "boolean") throw badRequest("invalid archived");
      patch.archived = body.archived;
    }
    return c.json({
      library: await withStore((s) => s.updateLibrary(actor(c), pathParam(c, "libraryId"), patch)),
    });
  });
  app.get("/:libraryId/files/:hash", async (c) => {
    const libraryId = pathParam(c, "libraryId"),
      hash = pathParam(c, "hash");
    if (!/^[a-f0-9]{64}$/.test(hash)) throw badRequest("invalid file identifier");
    await withStore(async (s) => {
      if (!(await s.listManaged(actor(c))).some((l) => l.id === libraryId))
        throw badRequest("Knowledge library unavailable.");
    });
    const bytes = await readFile(
      path.join(deps.root, "knowledge-base", "originals", actor(c).projectId, libraryId, hash),
    ).catch(() => null);
    if (!bytes) throw new HttpError(404, "knowledge_file_not_found", "Original file unavailable.");
    return c.body(bytes, 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment",
      "X-Content-Type-Options": "nosniff",
    });
  });
  // One binary file per HTTP request: never send a whole batch as chat Base64.
  app.post("/:libraryId/files", async (c) => {
    const libraryId = pathParam(c, "libraryId");
    return withStore(async (store) => {
      const libraries = await store.listManaged(actor(c));
      const library = libraries.find((l) => l.id === libraryId);
      if (!library || library.archived) throw badRequest("Knowledge library unavailable.");
      const name = c.req.query("name") ?? "";
      if (!name || name.length > 200) throw badRequest("invalid file name");
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = c.req.raw.body?.getReader();
      if (!reader) throw badRequest("empty file");
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 25 * 1024 * 1024) {
            await reader.cancel();
            throw new HttpError(
              413,
              "knowledge_file_too_large",
              "单文件最多 25 MB，请拆分后导入。",
            );
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = Buffer.concat(chunks);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const directory = path.join(
        deps.root,
        "knowledge-base",
        "originals",
        actor(c).projectId,
        libraryId,
      );
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, hash), bytes);
      let text = "",
        warning: string | undefined,
        error: string | undefined;
      try {
        ({ text, warning } = await extractKnowledgeFile(bytes, name));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const result = await store.importBatch(actor(c), libraryId, [
        {
          source: `knowledge-file://${hash}/${encodeURIComponent(name)}`,
          title: name,
          text,
          ...(error ? { error } : {}),
          expectedVersion: null,
        },
      ]);
      return c.json({ ...result, warning });
    });
  });
  app.post("/:libraryId/imports", async (c) => {
    const body = await readJson(c);
    if (!Array.isArray(body.items)) throw badRequest("items must be an array");
    return c.json(
      await withStore((s) =>
        s.importBatch(actor(c), pathParam(c, "libraryId"), body.items as unknown[]),
      ),
    );
  });
  app.get("/:libraryId/imports", async (c) =>
    c.json({ items: await withStore((s) => s.imports(actor(c), pathParam(c, "libraryId"))) }),
  );
  app.post("/:libraryId/imports/:itemId/retry", async (c) =>
    c.json(
      await withStore((s) =>
        s.retryImport(actor(c), pathParam(c, "libraryId"), pathParam(c, "itemId")),
      ),
    ),
  );
  app.get("/:libraryId/documents/:sourceId", async (c) =>
    c.json(
      await withStore((s) =>
        s.document(actor(c), pathParam(c, "libraryId"), pathParam(c, "sourceId")),
      ),
    ),
  );
  app.put("/:libraryId/documents/:sourceId", async (c) => {
    const body = await readJson(c);
    if (typeof body.enabled !== "boolean") throw badRequest("invalid enabled value");
    return c.json(
      await withStore((s) =>
        s.setSourceEnabled(
          actor(c),
          pathParam(c, "libraryId"),
          pathParam(c, "sourceId"),
          body.enabled as boolean,
        ),
      ),
    );
  });
  app.get("/:libraryId/connections", async (c) =>
    c.json({
      connections: await withStore((s) => s.connections(actor(c), pathParam(c, "libraryId"))),
    }),
  );
  app.put("/:libraryId/connections/:agentId", async (c) => {
    const agentId = requireValidId(c, "agentId");
    const projectId = requireValidId(c, "projectId");
    if (!deps.agents.exists(projectId, agentId))
      throw new HttpError(404, "agent_not_found", "Agent unavailable.");
    const body = await readJson(c);
    if (body.contribute !== undefined && typeof body.contribute !== "boolean")
      throw badRequest("contribute must be boolean.");
    await withStore((s) =>
      s.connect(actor(c), pathParam(c, "libraryId"), agentId, {
        contribute: body.contribute as boolean | undefined,
      }),
    );
    return c.body(null, 204);
  });
  app.delete("/:libraryId/connections/:agentId", async (c) => {
    await withStore((s) =>
      s.disconnect(actor(c), pathParam(c, "libraryId"), requireValidId(c, "agentId")),
    );
    return c.body(null, 204);
  });
  app.get("/:libraryId/sources", async (c) =>
    c.json({ sources: await withStore((s) => s.sources(actor(c), pathParam(c, "libraryId"))) }),
  );
  app.post("/:libraryId/sources", async (c) => {
    const body = await readJson(c);
    const input = {
      source: requireString(body, "source", { minLen: 1, maxLen: 2048 }),
      title: requireString(body, "title", { minLen: 1, maxLen: 200 }),
      text: requireString(body, "text", { minLen: 1, maxLen: 2_000_000 }),
      ...(body.expectedVersion === undefined
        ? {}
        : { expectedVersion: body.expectedVersion as string | null }),
    };
    if (
      body.expectedVersion !== undefined &&
      body.expectedVersion !== null &&
      typeof body.expectedVersion !== "string"
    )
      throw badRequest("invalid expected version");
    return c.json(
      await withStore((s) => s.ingest(actor(c), pathParam(c, "libraryId"), input)),
      201,
    );
  });
  app.post("/:libraryId/search", async (c) => {
    const body = await readJson(c);
    const query = requireString(body, "query", { minLen: 1, maxLen: 4000 });
    return c.json(await withStore((s) => s.search(actor(c), [pathParam(c, "libraryId")], query)));
  });
  app.get("/:libraryId/chunks/:chunkId", async (c) =>
    c.json(
      await withStore((s) => s.get(actor(c), pathParam(c, "libraryId"), pathParam(c, "chunkId"))),
    ),
  );
  app.get("/:libraryId/candidates", async (c) =>
    c.json({
      candidates: await withStore((s) => s.candidates(actor(c), pathParam(c, "libraryId"))),
    }),
  );
  app.post("/:libraryId/candidates/:candidateId/review", async (c) => {
    const body = await readJson(c);
    if (body.decision !== "accept" && body.decision !== "reject")
      throw badRequest("decision must be accept or reject.");
    return c.json(
      await withStore((s) =>
        s.review(
          actor(c),
          pathParam(c, "libraryId"),
          pathParam(c, "candidateId"),
          body.decision as string,
        ),
      ),
    );
  });
  return app;
}
