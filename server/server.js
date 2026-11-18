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

  // Logged for diagnosis only (stderr ends up in the Claude Desktop MCP log); holds no secrets.
  server.oninitialized = () => {
    const info = server.getClientVersion();
    console.error(
      `[ogsm-online] client ${info?.name} ${info?.version}, capabilities ${JSON.stringify(server.getClientCapabilities() || {})}`
    );
  };

  // When the client can show a form (MCP form elicitation), the user picks the environment there,
  // so Claude never sees the configured hosts. Claude Desktop does not offer form elicitation to
  // local (MCPB/stdio) servers: it declares no `elicitation` capability, or only `{ url: {} }`.
  // The SDK turns a bare `elicitation: {}` into `{ form: {} }`, so `form` is the one to check.
  // There is deliberately no default, so the user always makes the choice, even with one
  // environment. Resolves to { host } or { problem: "unsupported" | "declined" | "failed" }.
  // A client that declares form elicitation but fails to show it (or drops the request until it
  // times out) is not asked again in this process: the user types the host instead.
  let pickerFailed = false;
  const canPick = () => !pickerFailed && Boolean(server.getClientCapabilities()?.elicitation?.form);

  async function pick(names) {
    if (!canPick()) return { problem: "unsupported" };
    let result;
    try {
      result = await server.elicitInput({
        mode: "form",
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
      pickerFailed = true;
      return { problem: "failed" };
    }
    if (result.action !== "accept") return { problem: "declined" };
    const host = result.content?.environment;
    return names.includes(host) ? { host } : { problem: "declined" };
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callTool(request.params.name, request.params.arguments, { gate, fetch, pick, canPick })
  );
  return server;
}
