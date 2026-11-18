/** Context comes from the authenticated workbench mount; APIs still authorize every request. */
export function workbenchContext(pathname: string) {
  const match = /^(.*)\/projects\/([^/]+)\/agents\/([^/]+)\/workbenches\/[^/]+\/ui\//.exec(
    pathname,
  );
  if (!match)
    throw new Error("Open Knowledge Base from PenguinHarness App Center or a Session workbench.");
  return {
    projectId: decodeURIComponent(match[2]!),
    agentId: decodeURIComponent(match[3]!),
    projectApi: `${match[1]}/projects/${match[2]}`,
  };
}
