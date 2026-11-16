import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../server/server.js";
import { API_TOOLS, toolList } from "../server/tools.js";

const ENV = {
  OGSM_ENV_1_HOST: "klant.ogsm.online",
  OGSM_ENV_1_TOKEN: "test-token-aaaa",
  OGSM_ENV_2_HOST: "example.ogsm.online",
  OGSM_ENV_2_TOKEN: "test-token-bbbb",
};

function recordingFetch() {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization, body: init.body && JSON.parse(init.body) });
    const body = init.method === "GET" ? { data: [{ id: 1, ogsm_canvases: [{ id: 3 }] }], meta: { next_page: null } } : { id: 1 };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
}

async function connect({ env = ENV, elicit } = {}) {
  const { fetch, calls } = recordingFetch();
  const server = createServer({ env, fetch });
  const client = new Client({ name: "test", version: "0" }, { capabilities: elicit ? { elicitation: {} } : {} });
  if (elicit) client.setRequestHandler(ElicitRequestSchema, elicit);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content[0].text;
    return { isError: !!result.isError, text, json: result.isError ? undefined : JSON.parse(text) };
  };
  return { client, call, calls };
}

test("server instructions tell Claude to ask for the environment", async () => {
  const { client } = await connect();
  assert.match(client.getInstructions(), /ASK THE USER which environment/);
});

test("list_environments shows host names only, never tokens", async () => {
  const { call } = await connect();
  const result = await call("list_environments");
  assert.deepEqual(result.json.environments, ["klant.ogsm.online", "example.ogsm.online"]);
  assert.ok(!result.text.includes("test-token"));
});

test("every API tool refuses before an environment is selected, without calling the API", async () => {
  const { call, calls } = await connect();
  for (const tool of API_TOOLS) {
    const result = await call(tool.name, { canvas_id: 3, action_id: 1, comment_id: 2, title: "x", content: "x" });
    assert.ok(result.isError, `${tool.name} should refuse`);
    assert.match(result.text, /No OGSM.online environment is selected/, tool.name);
  }
  assert.equal(calls.length, 0);
});

test("a single configured environment still has to be selected explicitly", async () => {
  const { call, calls } = await connect({ env: { OGSM_ENV_1_HOST: "klant.ogsm.online", OGSM_ENV_1_TOKEN: "t" } });
  assert.ok((await call("list_canvases")).isError);
  assert.ok((await call("select_environment", {})).isError);
  assert.equal(calls.length, 0);
});

test("after select_environment, tools use that environment's host and token", async () => {
  const { call, calls } = await connect();
  const selected = await call("select_environment", { host: "example.ogsm.online" });
  const session = selected.json.environment_session;
  assert.equal(selected.json.environment, "example.ogsm.online");

  const result = await call("list_actions", { environment_session: session, canvas_id: 3 });
  assert.equal(result.json.environment, "example.ogsm.online");
  assert.deepEqual(calls.at(-1), {
    url: "https://example.ogsm.online/api/v3/actions.json?canvas_id=3&page=1",
    method: "GET",
    auth: "Bearer test-token-bbbb",
    body: undefined,
  });
});

test("switching needs another select_environment call", async () => {
  const { call, calls } = await connect();
  const first = (await call("select_environment", { host: "klant.ogsm.online" })).json.environment_session;
  const second = (await call("select_environment", { host: "example.ogsm.online" })).json.environment_session;
  await call("list_teams", { environment_session: first });
  await call("list_teams", { environment_session: second });
  assert.deepEqual(
    calls.map((c) => c.url),
    ["https://klant.ogsm.online/api/v3/teams.json?page=1", "https://example.ogsm.online/api/v3/teams.json?page=1"]
  );
});

test("select_environment refuses hosts that are not configured", async () => {
  const { call } = await connect();
  const result = await call("select_environment", { host: "evil.example.com" });
  assert.ok(result.isError);
  assert.match(result.text, /not a configured environment/);
});

test("with elicitation, the user's own pick decides and declining selects nothing", async () => {
  const asked = [];
  const answers = [
    { action: "accept", content: { environment: "klant.ogsm.online" } },
    { action: "decline" },
  ];
  const { call } = await connect({
    elicit: async (request) => {
      asked.push(request.params);
      return answers.shift();
    },
  });
  const picked = await call("select_environment", { host: "example.ogsm.online" });
  assert.equal(picked.json.environment, "klant.ogsm.online");
  assert.deepEqual(asked[0].requestedSchema.properties.environment.enum, ["klant.ogsm.online", "example.ogsm.online"]);
  assert.equal(asked[0].requestedSchema.properties.environment.default, undefined);

  const declined = await call("select_environment", { host: "example.ogsm.online" });
  assert.ok(declined.isError);
});

const ROUTES = [
  ["list_canvases", {}, "GET", "ogsm_canvases.json?page=1"],
  ["list_teams", {}, "GET", "teams.json?page=1"],
  ["list_users", {}, "GET", "users.json?page=1"],
  ["list_statuses", {}, "GET", "statuses.json?page=1"],
  ["list_actions", { canvas_id: 3 }, "GET", "actions.json?canvas_id=3&page=1"],
  ["create_action", { canvas_id: 3, title: "A" }, "POST", "actions.json", { ogsm_action: { title: "A", canvas: { id: 3 } } }],
  ["update_action", { action_id: 5, title: "B" }, "PATCH", "actions/5.json", { ogsm_action: { title: "B" } }],
  ["list_comments", { action_id: 5 }, "GET", "actions/5/comments.json?page=1"],
  ["create_comment", { action_id: 5, content: "<p>x</p>" }, "POST", "actions/5/comments.json", { comment: { content: "<p>x</p>" } }],
  ["update_comment", { action_id: 5, comment_id: 6, content: "y" }, "PATCH", "actions/5/comments/6.json", { comment: { content: "y" } }],
  ["delete_comment", { action_id: 5, comment_id: 6 }, "DELETE", "actions/5/comments/6.json"],
  ["list_objectives", {}, "GET", "objectives.json?page=1"],
  ["create_objective", { canvas_id: 3, title: "O" }, "POST", "objectives.json", { ogsm_objective: { title: "O", canvas: { id: 3 } } }],
  ["update_objective", { objective_id: 7, title: "O2" }, "PATCH", "objectives/7.json", { ogsm_objective: { title: "O2" } }],
  ["list_goals", {}, "GET", "goals.json?page=1"],
  ["create_goal", { canvas_id: 3, title: "G" }, "POST", "goals.json", { ogsm_goal: { title: "G", canvas: { id: 3 } } }],
  ["update_goal", { goal_id: 8, target_unit: "%" }, "PATCH", "goals/8.json", { ogsm_goal: { target_unit: "%" } }],
  ["list_strategies", {}, "GET", "strategies.json?page=1"],
  ["create_strategy", { canvas_id: 3, title: "S" }, "POST", "strategies.json", { ogsm_strategy: { title: "S", canvas: { id: 3 } } }],
  ["update_strategy", { strategy_id: 9, title: "S2" }, "PATCH", "strategies/9.json", { ogsm_strategy: { title: "S2" } }],
  ["list_indicators", {}, "GET", "indicators.json?page=1"],
  [
    "create_indicator",
    { canvas_id: 3, title: "I", parent_id: 9 },
    "POST",
    "indicators.json",
    { ogsm_indicator: { title: "I", canvas: { id: 3 }, parent: { id: 9 } } },
  ],
  ["update_indicator", { indicator_id: 10, title: "I2" }, "PATCH", "indicators/10.json", { ogsm_indicator: { title: "I2" } }],
  ["list_goal_reports", {}, "GET", "goal_reports.json?page=1"],
  ["list_indicator_reports", {}, "GET", "indicator_reports.json?page=1"],
];

test("every API tool sends the expected request", async () => {
  assert.deepEqual(ROUTES.map((r) => r[0]).sort(), API_TOOLS.map((t) => t.name).sort());
  const { call, calls } = await connect();
  const session = (await call("select_environment", { host: "klant.ogsm.online" })).json.environment_session;
  for (const [name, args, method, path, body] of ROUTES) {
    const result = await call(name, { environment_session: session, ...args });
    assert.ok(!result.isError, `${name}: ${result.text}`);
    const sent = calls.at(-1);
    assert.equal(sent.method, method, name);
    assert.equal(sent.url, `https://klant.ogsm.online/api/v3/${path}`, name);
    assert.deepEqual(sent.body, body, name);
  }
});

test("list tools can filter on a canvas", async () => {
  const { call } = await connect();
  const session = (await call("select_environment", { host: "klant.ogsm.online" })).json.environment_session;
  assert.equal((await call("list_goals", { environment_session: session, canvas_id: 3 })).json.data.length, 1);
  assert.equal((await call("list_goals", { environment_session: session, canvas_id: 4 })).json.data.length, 0);
});

test("manifest: 10 host + token slots, tokens sensitive, wired to env, tools in sync", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const env = manifest.server.mcp_config.env;
  for (let n = 1; n <= 10; n++) {
    assert.equal(manifest.user_config[`env_${n}_host`].type, "string");
    assert.notEqual(manifest.user_config[`env_${n}_host`].sensitive, true);
    assert.equal(manifest.user_config[`env_${n}_token`].sensitive, true);
    assert.equal(env[`OGSM_ENV_${n}_HOST`], `\${user_config.env_${n}_host}`);
    assert.equal(env[`OGSM_ENV_${n}_TOKEN`], `\${user_config.env_${n}_token}`);
  }
  assert.deepEqual(
    manifest.tools,
    toolList().map(({ name, description }) => ({ name, description })),
    "run npm run sync-tools"
  );
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, pkg.version);
});
