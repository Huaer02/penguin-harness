import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/**
 * Everything this plugin carries, declared for the plugin library. Data only: the class has no
 * body and the package no entry point; `build` writes this literal into `ifaces.json`.
 */
@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "knowledge-base.card",
        title: "Knowledge Base",
        titleZh: "知识库",
        descriptionZh:
          "Project 知识库：连接共享或专用资料库，检索带版本的证据并引用；任务发现先提交候选，经用户审核后生效。",
        shortDescription:
          "Connect Project knowledge libraries, retrieve cited evidence, and submit task findings for human review.",
        shortDescriptionZh: "连接 Project 知识库，检索引用证据，任务发现经用户审核后沉淀。",
        category: "office-productivity",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt:
            "Use the knowledge-base Skill to list connected libraries and their contribution permissions. For requested creation use kb_create; if permission is missing, explain how the Project owner enables Agent library creation in App Center → Knowledge Base. Ask which files or question the user wants to work with.",
          promptZh:
            "使用 knowledge-base 技能列出已连接的知识库及贡献权限。用户要求建库时使用 kb_create；缺少权限时说明如何由 Project owner 在应用中心的知识库页面开启 Agent 建库权限，并了解用户要处理的文件或问题。",
          skills: ["knowledge-base"],
        },
        references: [
          "https://doi.org/10.1561/1500000019",
          "https://doi.org/10.1145/1571941.1571977",
        ],
      },
    ],
    "PluginLibraryModule.workbenches": [
      {
        id: "knowledge-base.workbench",
        name: "knowledge-base",
        path: "workbenches/knowledge-base",
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "knowledge-base.skill.knowledge-base",
        name: "knowledge-base",
        path: "skills/knowledge-base",
      },
    ],
    "PluginLibraryModule.hooks": [
      {
        id: "knowledge-base.hooks",
        version: "2026.11.12.2",
        path: "hooks",
        stop: [{ command: "stop.mjs", timeout: 60 }],
      },
    ],
  },
})
export class KnowledgeBasePlugin {}

export default { modules: [KnowledgeBasePlugin] } satisfies Plugin;
