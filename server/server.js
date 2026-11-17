// Builds the MCP server for the OGSM.online API v3.

import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { EnvironmentGate, loadEnvironments } from "./environments.js";
import { SERVER_INSTRUCTIONS, callTool, toolList } from "./tools.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export function createServer({ env = process.env, fetch } = {}) {
  const { environments, problems } = loadEnvironments(env);
  for (const problem of problems) console.error(`[ogsm-online] ${problem}`);

  const gate = new EnvironmentGate(environments);
  const server = new Server(
    { name: "ogsm-online", version },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS }
  );

  // The user picks the environment in a form shown by the client itself (MCP elicitation), so
  // Claude never sees the configured hosts and cannot choose one. There is deliberately no
  // default, so the user always makes the choice, even with one environment.
  // Resolves to { host } or { problem: "unsupported" | "declined" | "failed" }.
  async function pick(names) {
    if (!server.getClientCapabilities()?.elicitation) return { problem: "unsupported" };
    let result;
    try {
      result = await server.elicitInput({
        message: "In which OGSM.online environment should Claude work in this conversation?",
        requestedSchema: {
          type: "object",
          properties: {
            environment: { type: "string", title: "OGSM.online environment", enum: names },
          },
          required: ["environment"],
        },
      });
    } catch (error) {
      console.error(`[ogsm-online] elicitation failed: ${error.message}`);
      return { problem: "failed" };
    }
    if (result.action !== "accept") return { problem: "declined" };
    const host = result.content?.environment;
    return names.includes(host) ? { host } : { problem: "declined" };
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callTool(request.params.name, request.params.arguments, { gate, fetch, pick })
  );
  return server;
}
