import { existsSync } from "node:fs";
import path from "node:path";
import { KnowledgeResources } from "@penguinharness/knowledge-base/service/resources.mjs";
/** Trusted lifecycle cleanup; preserve Project libraries and historical provenance. */
export function removeKnowledgeAgent(root: string, projectId: string, agentId: string): void {
  const filename = path.join(root, "knowledge-base/resources.db");
  if (!existsSync(filename)) return;
  const resources = new KnowledgeResources(filename, () => {
    throw new Error("Owner management unavailable in lifecycle cleanup");
  });
  try {
    resources.removeAgent(projectId, agentId);
  } finally {
    resources.close();
  }
}
