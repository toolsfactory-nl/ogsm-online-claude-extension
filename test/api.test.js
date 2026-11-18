import { test } from "node:test";
import assert from "node:assert/strict";
import { OgsmClient, buildRequest } from "../server/api.js";
import { actionBody, batchBody, cardBody, measurementBody } from "../server/tools.js";

const env = { host: "klant.ogsm.online", baseUrl: "https://klant.ogsm.online", token: "test-token-aaaa" };

function mockFetch(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift() ?? { status: 200, body: { data: [], meta: { next_page: null } } };
    const text = typeof next.body === "string" ? next.body : next.body === undefined ? "" : JSON.stringify(next.body);
    return { ok: next.status >= 200 && next.status < 300, status: next.status, text: async () => text };
  };
  return { fetch, calls };
}

test("buildRequest targets /api/v3 with a bearer token and JSON body", () => {
  const { url, init } = buildRequest(env, "POST", "actions.json", { body: { a: 1 }, query: { canvas_id: 5, x: undefined } });
  assert.equal(url, "https://klant.ogsm.online/api/v3/actions.json?canvas_id=5");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer test-token-aaaa");
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.equal(init.body, '{"a":1}');
});

test("getAll follows meta.next_page", async () => {
  const { fetch, calls } = mockFetch([
    { status: 200, body: { data: [{ id: 1 }], meta: { next_page: 2 } } },
    { status: 200, body: { data: [{ id: 2 }], meta: { next_page: null } } },
  ]);
  const records = await new OgsmClient(env, { fetch }).getAll("actions.json", { canvas_id: 7 });
  assert.deepEqual(records, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(
    calls.map((c) => c.url),
    [
      "https://klant.ogsm.online/api/v3/actions.json?canvas_id=7&page=1",
      "https://klant.ogsm.online/api/v3/actions.json?canvas_id=7&page=2",
    ]
  );
});

test("a 204 answers null", async () => {
  const { fetch } = mockFetch([{ status: 204 }]);
  assert.equal(await new OgsmClient(env, { fetch }).delete("actions/1/comments/2.json"), null);
});

test("read_only_token is explained without the token", async () => {
  const { fetch } = mockFetch([{ status: 403, body: { error: "read_only_token" } }]);
  await assert.rejects(new OgsmClient(env, { fetch }).post("actions.json", {}), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.error, "read_only_token");
    assert.match(error.message, /read_only_token/);
    assert.match(error.message, /this token can only read/);
    assert.match(error.message, /Read and write/);
    assert.ok(!error.message.includes(env.token));
    return true;
  });
});

test("422 lists the field errors", async () => {
  const { fetch } = mockFetch([{ status: 422, body: { parent: ["is required: the id of a card"], title: ["can't be blank"] } }]);
  await assert.rejects(new OgsmClient(env, { fetch }).post("indicators.json", {}), (error) => {
    assert.equal(error.status, 422);
    assert.match(error.message, /validation failed: parent: is required: the id of a card; title: can't be blank/);
    return true;
  });
});

test("401 and HTML 404 bodies give readable errors", async () => {
  const { fetch } = mockFetch([
    { status: 401, body: "" },
    { status: 404, body: "<html>not found</html>" },
  ]);
  const client = new OgsmClient(env, { fetch });
  await assert.rejects(client.get("teams.json"), /token was refused.*my_settings\/account/);
  await assert.rejects(client.get("teams.json"), /not found/);
});

test("actionBody mirrors the ogsm CLI request shape", () => {
  assert.deepEqual(
    actionBody(
      { canvas_id: 3, title: "T", strategy_id: 9, list: "doing", label_ids: ["a", "b"], assignee_id: 4, due: "2026-12-01", priority: "high", effort: 3 },
      { create: true }
    ),
    {
      ogsm_action: {
        title: "T",
        due: "2026-12-01",
        list: "doing",
        effort: 3,
        priority: "high",
        assignee_id: 4,
        label_ids: ["a", "b"],
        canvas: { id: 3 },
        strategy: { id: 9 },
      },
    }
  );
  assert.deepEqual(actionBody({ action_id: 1, list: "done", assignee_id: null, label_ids: [] }, { create: false }), {
    ogsm_action: { list: "done", assignee_id: null, label_ids: [] },
  });
  assert.deepEqual(actionBody({ action_id: 1, strategy_id: 4, canvas_id: 2, title: "x" }, { create: false }), {
    ogsm_action: { title: "x" },
  });
  assert.throws(() => actionBody({ action_id: 1 }, { create: false }), /Nothing to change/);
});

test("cardBody uses ogsm_<kind>, canvas.id and parent.id only where allowed", () => {
  assert.deepEqual(cardBody("objective", { canvas_id: 1, title: "O", parent_id: 5 }, { create: true }), {
    ogsm_objective: { title: "O", canvas: { id: 1 } },
  });
  assert.deepEqual(cardBody("strategy", { canvas_id: 1, title: "S", parent_id: 5 }, { create: true }), {
    ogsm_strategy: { title: "S", canvas: { id: 1 } },
  });
  assert.deepEqual(
    cardBody("goal", { canvas_id: 1, title: "G", parent_id: 2, target_unit: "%", chart_type: "year_sum" }, { create: true }),
    { ogsm_goal: { title: "G", target_unit: "%", chart_type: "year_sum", canvas: { id: 1 }, parent: { id: 2 } } }
  );
  assert.deepEqual(cardBody("indicator", { canvas_id: 1, title: "I", parent_id: 8 }, { create: true }), {
    ogsm_indicator: { title: "I", canvas: { id: 1 }, parent: { id: 8 } },
  });
  assert.deepEqual(cardBody("strategy", { strategy_id: 4, label_ids: ["x"] }, { create: false }), {
    ogsm_strategy: { label_ids: ["x"] },
  });
  assert.deepEqual(cardBody("objective", { objective_id: 4, target_unit: "%", title: "O" }, { create: false }), {
    ogsm_objective: { title: "O" },
  });
  assert.deepEqual(cardBody("goal", { goal_id: 4, canvas_id: 1, parent_id: 2, chart_vertical_min: 0 }, { create: false }), {
    ogsm_goal: { chart_vertical_min: 0 },
  });
});

test("measurementBody uses <kind>_report and <kind>.id only on create", () => {
  assert.deepEqual(
    measurementBody("goal", { goal_id: 301, at: "2026-10-31", current_value: 42, target_value: 50, traffic_light: "oranje", show_in_ogsm: false }, { create: true }),
    { goal_report: { at: "2026-10-31", current_value: 42, target_value: 50, traffic_light: "oranje", show_in_ogsm: false, goal: { id: 301 } } }
  );
  assert.deepEqual(
    measurementBody("indicator", { indicator_report_id: 5, indicator_id: 9, current_value: "43,5", traffic_light: null }, { create: false }),
    { indicator_report: { current_value: "43,5", traffic_light: null } }
  );
  assert.throws(() => measurementBody("goal", { goal_report_id: 5 }, { create: false }), /Nothing to change/);
});

test("batchBody maps operations and refuses more than 500", () => {
  assert.deepEqual(
    batchBody("goal", {
      operations: [
        { op: "create", goal_id: 301, at: "2026-10-31", current_value: 42, traffic_light: "groen" },
        { op: "update", id: 9001, current_value: 43 },
        { op: "delete", id: 9002, current_value: 1 },
      ],
    }),
    {
      goal_report_batch: {
        operations: [
          { op: "create", goal: { id: 301 }, at: "2026-10-31", current_value: 42, traffic_light: "groen" },
          { op: "update", id: 9001, current_value: 43 },
          { op: "delete", id: 9002 },
        ],
      },
    }
  );
  assert.deepEqual(batchBody("indicator", { operations: [{ op: "create", indicator_id: 4, at: "2026-01-01" }] }), {
    indicator_report_batch: { operations: [{ op: "create", indicator: { id: 4 }, at: "2026-01-01" }] },
  });
  const many = Array.from({ length: 501 }, (_, i) => ({ op: "delete", id: i + 1 }));
  assert.throws(() => batchBody("goal", { operations: many }), /at most 500/);
  assert.equal(batchBody("goal", { operations: many.slice(0, 500) }).goal_report_batch.operations.length, 500);
  assert.throws(() => batchBody("goal", { operations: [] }), /non-empty/);
  assert.throws(() => batchBody("goal", { operations: [{ op: "upsert", id: 1 }] }), /create, update or delete/);
  assert.throws(() => batchBody("goal", { operations: [{ op: "update" }] }), /operations\[0\]\.id/);
});

test("error bodies become short readable messages without HTML", async () => {
  const { fetch } = mockFetch([
    { status: 404, body: "<!DOCTYPE html><html><body><h1>The page you were looking for doesn't exist.</h1></body></html>" },
    { status: 404, body: { error: "Goal Not Found" } },
    { status: 400, body: { error: "invalid_page" } },
    { status: 422, body: { operations: [{ index: 0, errors: ["op is invalid"] }] } },
    { status: 429, body: "" },
    { status: 403, body: { error: "Personal authentication required" } },
    { status: 500, body: "<html>boom</html>" },
  ]);
  const client = new OgsmClient(env, { fetch });
  const messages = [];
  for (let i = 0; i < 7; i++) {
    await assert.rejects(client.get("goals.json"), (error) => (messages.push(error.message), true));
  }
  for (const message of messages) assert.doesNotMatch(message, /<|html/i);
  assert.match(messages[0], /not found: the record does not exist or is not visible/);
  assert.match(messages[1], /not found: Goal Not Found/);
  assert.match(messages[2], /invalid_page/);
  assert.match(messages[3], /operations: \{"index":0,"errors":\["op is invalid"\]\}/);
  assert.match(messages[4], /rate limited: too many requests/);
  assert.match(messages[5], /personal API token/);
  assert.equal(messages[6], "klant.ogsm.online answered 500.");
});

test("a 202 batch answer is returned as JSON", async () => {
  const batch = { id: "0b9e6c2e-1111-4222-8333-444455556666", status: "queued", operation_count: 1, results: [] };
  const { fetch } = mockFetch([{ status: 202, body: batch }]);
  assert.deepEqual(await new OgsmClient(env, { fetch }).post("goal_report_batches.json", {}), batch);
});
