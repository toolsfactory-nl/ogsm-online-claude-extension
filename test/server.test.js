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

// By default the client supports (form) elicitation and the user picks `choose`. `elicitation`
// can also be false (no capability, as Claude Desktop declares to local servers) or a capability
// object such as { url: {} }.
async function connect({ env = ENV, choose = "klant.ogsm.online", elicit, elicitation = true } = {}) {
  const { fetch, calls } = recordingFetch();
  const server = createServer({ env, fetch });
  const capability = elicitation === true ? {} : elicitation;
  const client = new Client({ name: "test", version: "0" }, { capabilities: capability ? { elicitation: capability } : {} });
  const asked = [];
  if (elicitation) {
    client.setRequestHandler(
      ElicitRequestSchema,
      elicit ||
        (async (request) => {
          asked.push(request.params);
          return { action: "accept", content: { environment: choose } };
        })
    );
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content[0].text;
    return { isError: !!result.isError, text, json: result.isError ? undefined : JSON.parse(text) };
  };
  const select = async () => (await call("select_environment", { environment_session: null })).json.environment_session;
  return { client, call, calls, asked, select };
}

const OTHER_HOST = "example.ogsm.online";

test("instructions keep Claude in the one selected environment", async () => {
  const { client } = await connect();
  const instructions = client.getInstructions();
  assert.match(instructions, /one OGSM.online environment per conversation/);
  assert.match(instructions, /Never mention, suggest,\s+guess or compare any other environment/);
  assert.match(instructions, /start a new\s+conversation/);
  assert.doesNotMatch(instructions, /switch/i);
});

test("there is no tool that lists environments, and no tool text names a host or offers switching", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(!names.includes("list_environments"));
  assert.ok(names.includes("select_environment"));
  const published = JSON.stringify(tools) + client.getInstructions();
  assert.ok(!published.includes("klant.ogsm.online") && !published.includes(OTHER_HOST));
  assert.doesNotMatch(published, /switch|list_environments|environments configured|configured environments/i);
});

test("instructions tell Claude to ask and pass on literally what the user typed", async () => {
  const { client } = await connect();
  const instructions = client.getInstructions();
  assert.match(instructions, /without suggesting, guessing or completing a host name/);
  assert.match(instructions, /one short question in their language/);
  assert.match(instructions, /In welke\s+OGSM.online-omgeving wil je werken\?/);
  assert.match(instructions, /no explanation, apology or technical detail/);
});

test("with the picker, a host from Claude is refused and nobody is asked", async () => {
  const { client, call, asked } = await connect();
  const { tools } = await client.listTools();
  const select = tools.find((t) => t.name === "select_environment");
  assert.deepEqual(Object.keys(select.inputSchema.properties), ["environment_session", "host"]);
  assert.deepEqual(select.inputSchema.required, ["environment_session"]);
  const result = await call("select_environment", { environment_session: null, host: OTHER_HOST });
  assert.ok(result.isError);
  assert.match(result.text, /Do not pass host/);
  assert.equal(asked.length, 0);
  assert.ok((await call("select_environment", { environment_session: null, other: "x" })).isError);
});

test("the user picks from all hosts without a default, and only the chosen host reaches Claude", async () => {
  const { call, calls, asked } = await connect({ choose: OTHER_HOST });
  const selected = await call("select_environment", { environment_session: null });
  const property = asked[0].requestedSchema.properties.environment;
  assert.deepEqual(property.enum, ["klant.ogsm.online", OTHER_HOST]);
  assert.equal(property.default, undefined);
  assert.equal(selected.json.environment, OTHER_HOST);
  assert.ok(!selected.text.includes("klant.ogsm.online"), "the other host is not in the output");
  assert.doesNotMatch(selected.text, /switch|another environment/i);

  const result = await call("list_actions", { environment_session: selected.json.environment_session, canvas_id: 3 });
  assert.equal(result.json.environment, OTHER_HOST);
  assert.deepEqual(calls.at(-1), {
    url: "https://example.ogsm.online/api/v3/actions.json?canvas_id=3&page=1",
    method: "GET",
    auth: "Bearer test-token-bbbb",
    body: undefined,
  });
});

test("even a single configured environment is chosen by the user", async () => {
  const { call, asked } = await connect({ env: { OGSM_ENV_1_HOST: "klant.ogsm.online", OGSM_ENV_1_TOKEN: "t" } });
  assert.equal((await call("select_environment", { environment_session: null })).json.environment, "klant.ogsm.online");
  assert.equal(asked.length, 1);
});

test("declining the picker selects nothing and names no environment", async () => {
  const { call, calls } = await connect({ elicit: async () => ({ action: "decline" }) });
  const result = await call("select_environment", { environment_session: null });
  assert.ok(result.isError);
  assert.ok(!result.text.includes("ogsm.online environment:") && !result.text.includes(OTHER_HOST));
  assert.ok(!result.text.includes("klant.ogsm.online"));
  assert.equal(calls.length, 0);
});

test("a picked value that is not configured selects nothing", async () => {
  const { call } = await connect({ elicit: async () => ({ action: "accept", content: { environment: "evil.example.com" } }) });
  const result = await call("select_environment", { environment_session: null });
  assert.ok(result.isError || result.json.environment_session === null, result.text);
  assert.ok(!result.text.includes("evil.example.com"));
});

// Claude Desktop declares no elicitation capability to local (MCPB/stdio) servers, and its chat
// declares only URL elicitation; neither can show the picker.
for (const [label, elicitation] of [
  ["no elicitation", false],
  ["URL elicitation only", { url: {} }],
]) {
  test(`${label}: Claude is told to ask the user, and learns no host`, async () => {
    const { call, calls, asked } = await connect({ elicitation });
    const result = await call("select_environment", { environment_session: null });
    assert.ok(!result.isError, result.text);
    assert.equal(result.json.environment, null);
    assert.equal(result.json.environment_session, null);
    const step = result.json.next_step;
    assert.match(step, /ask the user only this one short question,\s+in their language/);
    assert.match(step, /In welke OGSM.online-omgeving wil je werken\?/);
    assert.match(step, /no explanation, no apology, and do not mention a\s+picker, form, host name or https:\/\//);
    assert.match(step, /Do not suggest, guess, list or complete a host name, give no example/);
    assert.match(step, /exactly what the user typed/);
    assert.doesNotMatch(step, /cannot show|keuzelijst|hostnaam|without https/i);
    assert.ok(!result.text.includes("klant.ogsm.online") && !result.text.includes(OTHER_HOST));
    assert.doesNotMatch(result.text, /update Claude Desktop/);
    assert.equal(asked.length, 0);
    assert.ok((await call("list_canvases", {})).isError);
    assert.equal(calls.length, 0);
  });
}

test("without the picker, the host the user typed selects that environment only on an exact match", async () => {
  for (const typed of [OTHER_HOST, " Example.OGSM.online ", "https://example.ogsm.online/"]) {
    const { call, calls } = await connect({ elicitation: false });
    const selected = await call("select_environment", { environment_session: null, host: typed });
    assert.ok(!selected.isError, `${typed}: ${selected.text}`);
    assert.equal(selected.json.environment, OTHER_HOST);
    assert.ok(!selected.text.includes("klant.ogsm.online"));
    const session = selected.json.environment_session;
    assert.equal((await call("list_teams", { environment_session: session })).json.environment, OTHER_HOST);
    assert.equal(calls.at(-1).auth, "Bearer test-token-bbbb");
  }
});

test("without the picker, a host that does not match is refused without naming a configured host", async () => {
  for (const typed of ["klant.ogsm.onlin", "klant", "ogsm.online", "klant.ogsm.online/teams", "evil.example.com", "", "*"]) {
    const { call, calls } = await connect({ elicitation: false });
    const result = await call("select_environment", { environment_session: null, host: typed });
    assert.ok(result.isError, typed);
    assert.match(result.text, /not one of the OGSM.online environments/);
    assert.match(result.text, /bijvoorbeeld bedrijf\.ogsm\.online/);
    assert.match(result.text, /Do not explain or apologise, and do not suggest or guess a host/);
    assert.ok(!result.text.includes("klant.ogsm.online") && !result.text.includes(OTHER_HOST), result.text);
    assert.equal(calls.length, 0);
  }
});

test("without the picker, repeated misses are throttled so hosts cannot be probed", async () => {
  const { call } = await connect({ elicitation: false });
  for (let i = 0; i < 5; i++) {
    assert.match((await call("select_environment", { environment_session: null, host: `guess${i}.ogsm.online` })).text, /not one of/);
  }
  const blocked = await call("select_environment", { environment_session: null, host: "klant.ogsm.online" });
  assert.ok(blocked.isError);
  assert.match(blocked.text, /Too many host names/);
  assert.ok(!blocked.text.includes(OTHER_HOST));
});

test("without the picker, a conversation still works in one environment only", async () => {
  const { call } = await connect({ elicitation: false });
  const session = (await call("select_environment", { environment_session: null, host: "klant.ogsm.online" })).json.environment_session;
  const second = await call("select_environment", { environment_session: session, host: OTHER_HOST });
  assert.ok(second.isError);
  assert.match(second.text, /start a new conversation to work with another environment/i);
  assert.ok(!second.text.includes(OTHER_HOST));
  assert.equal((await call("list_teams", { environment_session: session })).json.environment, "klant.ogsm.online");
});

test("a picker that fails falls back to asking the user", async () => {
  const { call } = await connect({
    elicit: async () => {
      throw new Error("not shown");
    },
  });
  const first = await call("select_environment", { environment_session: null });
  assert.match(first.json.next_step, /ask the user only this one short question/);
  const selected = await call("select_environment", { environment_session: null, host: OTHER_HOST });
  assert.equal(selected.json.environment, OTHER_HOST);
});

test("a conversation with a valid environment_session cannot select a second environment", async () => {
  const { call, asked, select } = await connect();
  const session = await select();
  const second = await call("select_environment", { environment_session: session });
  assert.ok(second.isError);
  assert.match(second.text, /start a new conversation to work with another environment/i);
  assert.match(second.text, /klant\.ogsm\.online/);
  assert.ok(!second.text.includes(OTHER_HOST));
  assert.equal(asked.length, 1, "the user is not asked again");
  assert.equal((await call("list_teams", { environment_session: session })).json.environment, "klant.ogsm.online");
});

test("environment_session is required, so Claude has to state whether the conversation has one", async () => {
  const { call } = await connect();
  assert.ok((await call("select_environment", {})).isError);
});

test("an unknown or expired environment_session leads to a fresh pick", async () => {
  const { call, asked } = await connect();
  const result = await call("select_environment", { environment_session: "made-up" });
  assert.equal(result.json.environment, "klant.ogsm.online");
  assert.equal(asked.length, 1);
});

test("no tool output leaks another configured host", async () => {
  const { call, select } = await connect();
  const session = await select();
  const outputs = [];
  for (const tool of API_TOOLS) {
    outputs.push((await call(tool.name, { environment_session: session, canvas_id: 3, action_id: 1, comment_id: 2, title: "x", content: "x", parent_id: 1, objective_id: 1, goal_id: 1, strategy_id: 1, indicator_id: 1 })).text);
    outputs.push((await call(tool.name, {})).text);
  }
  for (const text of outputs) assert.ok(!text.includes(OTHER_HOST), text);
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

test("no configured environment: select_environment points to the settings", async () => {
  const { call, asked } = await connect({ env: {} });
  const result = await call("select_environment", { environment_session: null });
  assert.match(result.text, /extension settings/);
  assert.equal(asked.length, 0);
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
  const { call, calls, select } = await connect();
  const session = await select();
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
  const { call, select } = await connect();
  const session = await select();
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
