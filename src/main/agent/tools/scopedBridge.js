import crypto from "node:crypto";
import http from "node:http";
import { suiteToolDefs } from "./suiteTools";

let scopedServer = null,
  scopedPort = 0;
const scoped = new Map();
async function handleScoped(req, res, run) {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const mcp = new McpServer(
    { name: "suite", version: "1.0.0" },
    {
      instructions:
        "Videoxx tools for the project open in this run (your working folder): render_frames, check_preview, list_shots, get_selection, narration and the rest work like inside the app.",
    },
  );
  for (const d of suiteToolDefs(run.projectId, run.selection, run.ledger))
    mcp.tool(d.name, d.description, d.schema, async (args) => d.handler(args));
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
function startScoped() {
  if (scopedServer?.listening) return Promise.resolve(scopedPort);
  const srv = http.createServer((req, res) => {
    const host = String(req.headers.host || "").replace(/:\d+$/, "");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host) || req.headers.origin) {
      res.writeHead(403);
      return res.end();
    }
    const m = /^\/s\/([a-f0-9]{48})\/mcp$/.exec(String(req.url || "").split("?")[0]),
      run = m ? scoped.get(m[1]) : void 0;
    if (!run) {
      res.writeHead(404);
      return res.end();
    }
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      return res.end();
    }
    handleScoped(req, res, run).catch((e) => {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: String(e?.message || e) }, id: null }));
    });
  });
  return new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      scopedServer = srv;
      scopedPort = srv.address().port;
      resolve(scopedPort);
    });
  });
}
export async function registerScoped(projectId, selection = [], ledger) {
  const port = await startScoped(),
    token = crypto.randomBytes(24).toString("hex");
  scoped.set(token, { projectId, selection, ledger });
  return {
    url: `http://127.0.0.1:${port}/s/${token}/mcp`,
    dispose: () => {
      scoped.delete(token);
    },
  };
}
