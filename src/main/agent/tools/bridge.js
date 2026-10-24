import http from "node:http";
import { z } from "zod";
import { getConfig } from "../../core/config";
import { q } from "../../db/db";
import { rulesText } from "../projectContext";
import { suiteToolDefs } from "./suiteTools";

let server = null;
let activeProject = null;
export const setActiveProject = (id) => {
  activeProject = id;
};
const bridgePort = () => +(process.env.CZ_BRIDGE_PORT || getConfig().bridge.port);
export const bridgeInfo = () => ({
  running: !!server?.listening,
  port: bridgePort(),
  url: `http://127.0.0.1:${bridgePort()}/mcp`,
  command: `claude mcp add --transport http videoxx http://127.0.0.1:${bridgePort()}/mcp`,
});
function resolveProject(ref) {
  if (ref) {
    const p = q.get("SELECT * FROM projects WHERE id=? OR name=? OR slug=?", ref, ref, ref);
    if (p) return p;
    throw new Error(`No project "${ref}".`);
  }
  if (!activeProject) throw new Error("No project is open in Videoxx. Open one, or pass `project`.");
  return q.get("SELECT * FROM projects WHERE id=?", activeProject);
}
async function handle(req, res) {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const mcp = new McpServer(
    { name: "videoxx", version: "1.0.0" },
    {
      instructions:
        "Videoxx bridge: the user selects shots/objects in the Suite editor and asks you to change them. Call active_project first to get the project folder, then edit files there (the live preview hot-reloads). Use get_selection, list_shots, render_frames and check_preview like inside the app.",
    },
  );
  mcp.tool("active_project", "The project open in Videoxx: name, folder path (edit files here), length, preset.", {}, async () => {
    const p = resolveProject();
    const rules = rulesText(p.id);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              id: p.id,
              name: p.name,
              path: p.path,
              duration: p.duration,
              preset: p.preset_id,
              context: `${p.path}/CLAUDE.md`,
              styleRules: rules,
            },
            null,
            1,
          ),
        },
      ],
    };
  });
  mcp.tool("list_projects", "All Videoxx projects (with the channel each one is for and its due date, when set).", {}, async () => ({
    content: [
      {
        type: "text",
        text:
          q
            .all(
              "SELECT p.id,p.name,p.path,p.status,p.duration,p.due_at,c.name AS channel FROM projects p LEFT JOIN channels c ON c.id = p.channel_id ORDER BY p.updated_at DESC",
            )
            .map(
              (p) =>
                `${p.name} (${p.id}) ${p.status} ${p.duration}s${p.channel ? `  channel: ${p.channel}` : ""}${p.due_at ? `  due ${p.due_at}` : ""}  ${p.path}`,
            )
            .join("\n") || "No projects.",
      },
    ],
  }));
  for (const d of suiteToolDefs("__bridge__")) {
    mcp.tool(
      d.name,
      d.description,
      { ...d.schema, project: z.string().optional().describe("project id or name; default = the one open in the Suite") },
      async (args) => {
        const p = resolveProject(args.project);
        const real = suiteToolDefs(p.id).find((x) => x.name === d.name);
        return await real.handler(args);
      },
    );
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: void 0 });
  res.on("close", () => {
    transport.close();
    mcp.close();
  });
  await mcp.connect(transport);
  const body = await new Promise((r) => {
    let s = "";
    req.on("data", (d) => (s += d));
    req.on("end", () => {
      try {
        r(s ? JSON.parse(s) : void 0);
      } catch {
        r(void 0);
      }
    });
  });
  await transport.handleRequest(req, res, body);
}
export function startBridge() {
  const cfg = getConfig().bridge;
  if (!cfg.enabled || server) return Promise.resolve(!!server);
  server = http.createServer((req, res) => {
    const host = String(req.headers.host || "").replace(/:\d+$/, "");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host) || req.headers.origin) {
      res.writeHead(403);
      return res.end();
    }
    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404);
      return res.end();
    }
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      return res.end();
    }
    handle(req, res).catch((e) => {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: String(e?.message || e) }, id: null }));
    });
  });
  return new Promise((resolve) => {
    server.once("error", () => {
      server = null;
      resolve(false);
    });
    server.listen(bridgePort(), "127.0.0.1", () => resolve(true));
  });
}
export function stopBridge() {
  server?.close();
  server = null;
}
