import { KnowledgeResources, KnowledgeAgent, KnowledgeUser } from "./resources.mjs";
export type Actor = KnowledgeAgent | KnowledgeUser;
export type Citation = {
  chunkId: string;
  versionId: string;
  libraryId: string;
  source: string;
  title: string;
  heading: string;
  span: number[];
  text: string;
  current: boolean;
  sourceId: string;
  enabled: boolean;
  citationUrl: string;
};
export type Embedding = { id: string; embed(texts: string[]): Promise<number[][]> };
export class KnowledgeContent extends KnowledgeResources {
  constructor(
    filename: string,
    authorizeOwner: (userId: string, projectId: string) => unknown | Promise<unknown>,
    embedding?: Embedding | null,
  );
  ingest(
    actor: Actor,
    libraryId: string,
    input: { source: string; title: string; text: string; expectedVersion?: string | null },
  ): Promise<{ versionId: string; unchanged: boolean }>;
  sources(
    actor: Actor,
    libraryId: string,
  ): Promise<
    {
      sourceId: string;
      enabled: boolean;
      chunkCount: number;
      versionId: string;
      source: string;
      title: string;
      createdAt: string;
    }[]
  >;
  document(
    actor: Actor,
    libraryId: string,
    id: string,
  ): Promise<{
    sourceId: string;
    source: string;
    enabled: boolean;
    versions: {
      versionId: string;
      title: string;
      text: string;
      createdAt: string;
      current: boolean;
      processing: { chunkCount: number; embedded: boolean };
      chunks: Citation[];
    }[];
  }>;
  setSourceEnabled(
    actor: KnowledgeUser,
    libraryId: string,
    id: string,
    enabled: boolean,
  ): Promise<{ sourceId: string; enabled: boolean }>;
  importBatch(
    actor: Actor,
    libraryId: string,
    items: unknown[],
    sessionId?: string,
  ): Promise<{ items: Record<string, unknown>[] }>;
  imports(actor: KnowledgeUser, libraryId: string): Promise<Record<string, unknown>[]>;
  retryImport(
    actor: KnowledgeUser,
    libraryId: string,
    id: string,
  ): Promise<{ items: Record<string, unknown>[] }>;
  backup(actor: KnowledgeUser): Promise<Record<string, unknown>>;
  restore(
    actor: KnowledgeUser,
    backup: unknown,
    agentExists: (id: string) => boolean,
  ): Promise<{ libraries: number; versions: number; skippedAgentRows: number }>;
  get(actor: Actor, libraryId: string, chunkId: string): Promise<Citation>;
  search(
    actor: Actor,
    libraryIds: string[],
    query: string,
    options?: { topK?: number; mode?: string },
  ): Promise<{
    diagnostics: { requestedMode: string; libraries: number; sources: number; chunks: number };
    modeUsed: string;
    note?: string;
    results: (Citation & { score: number })[];
  }>;
  proposeImport(
    actor: KnowledgeAgent,
    libraryId: string,
    sessionId: string,
    input: { source: string; title: string; text: string; expectedVersion?: string | null },
  ): Promise<{ id: string; status: string; unchanged?: boolean }>;
  propose(
    actor: KnowledgeAgent,
    libraryId: string,
    input: {
      taskId: string;
      sessionId: string;
      title: string;
      conclusion: string;
      conditions: string;
      evidence: string[];
    },
  ): Promise<{ id: string; unchanged?: boolean }>;
  candidates(actor: KnowledgeUser, libraryId: string): Promise<Record<string, unknown>[]>;
  review(
    actor: KnowledgeUser,
    libraryId: string,
    id: string,
    decision: string,
  ): Promise<{ id: string; status: string; versionId: string | null }>;
}

export function environmentEmbedding(env?: NodeJS.ProcessEnv): Embedding | null;
