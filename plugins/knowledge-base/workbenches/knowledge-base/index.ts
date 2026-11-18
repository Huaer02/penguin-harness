import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";

export default {
  modules: {
    Workbench: {
      create({ use }) {
        return {
          api: {
            main: {
              async handle(request) {
                if (request.method === "GET" && request.path === "/agents") {
                  return { body: { agents: use.host.listAgents() } };
                }
                return { status: 404, body: { error: "Not found" } };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
