export type KnowledgeUser = { kind: "user"; userId: string; projectId: string };
export type KnowledgeAgent = { kind: "agent"; agentId: string; projectId: string };
export type KnowledgeLibrary = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  archived: boolean;
  shared?: boolean;
};
export class KnowledgeResources {
  constructor(
    filename: string,
    authorizeOwner: (userId: string, projectId: string) => unknown | Promise<unknown>,
  );
  close(): void;
  canImport(actor: KnowledgeAgent): boolean;
  importPermission(actor: KnowledgeUser, agentId: string): Promise<{ allowed: boolean }>;
  setImportPermission(
    actor: KnowledgeUser,
    agentId: string,
    allowed: boolean,
  ): Promise<{ allowed: boolean }>;
  create(actor: KnowledgeUser, name: string): Promise<KnowledgeLibrary>;
  creationPermission(actor: KnowledgeUser, agentId: string): Promise<{ allowed: boolean }>;
  setCreationPermission(
    actor: KnowledgeUser,
    agentId: string,
    allowed: boolean,
  ): Promise<{ allowed: boolean }>;
  createForAgent(
    actor: KnowledgeAgent,
    input: { name: string; requestId: string },
  ): Promise<{
    library: KnowledgeLibrary;
    created: boolean;
    connected: boolean;
    contribute: boolean;
  }>;
  updateLibrary(
    actor: KnowledgeUser,
    id: string,
    patch: { name?: string; description?: string; archived?: boolean; shared?: boolean },
  ): Promise<KnowledgeLibrary>;
  removeAgent(projectId: string, agentId: string): void;
  listManaged(actor: KnowledgeUser): Promise<KnowledgeLibrary[]>;
  connections(
    actor: KnowledgeUser,
    libraryId: string,
  ): Promise<{ agentId: string; contribute: boolean }[]>;
  connect(
    actor: KnowledgeUser,
    libraryId: string,
    agentId: string,
    options?: { contribute?: boolean },
  ): Promise<void>;
  disconnect(actor: KnowledgeUser, libraryId: string, agentId: string): Promise<void>;
  requireAccess(
    actor: KnowledgeAgent,
    libraryId: string,
    operation?: "read" | "contribute",
  ): KnowledgeLibrary & { contribute: boolean };
  list(actor: KnowledgeAgent): (KnowledgeLibrary & { contribute: boolean })[];
  scope(
    actor: KnowledgeAgent,
    libraryIds: string[],
  ): (KnowledgeLibrary & { contribute: boolean })[];
}
