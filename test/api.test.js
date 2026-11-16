import { test } from "node:test";
import assert from "node:assert/strict";
import { OgsmClient, buildRequest } from "../server/api.js";
import { actionBody, cardBody } from "../server/tools.js";

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
    assert.match(error.message, /read only/);
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
      { canvas_id: 3, title: "T", strategy_id: 9, status: "doing", labels: ["a", "b"], assignee_id: 4, due: "2026-12-01" },
      { create: true }
    ),
    {
      ogsm_action: {
        title: "T",
        due: "2026-12-01",
        list: "doing",
        assignee_id: 4,
        label_ids: ["a", "b"],
        canvas: { id: 3 },
        strategy: { id: 9 },
      },
    }
  );
  assert.deepEqual(actionBody({ action_id: 1, status: "done" }, { create: false }), { ogsm_action: { list: "done" } });
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
  assert.deepEqual(cardBody("strategy", { strategy_id: 4, labels: ["x"] }, { create: false }), {
    ogsm_strategy: { label_ids: ["x"] },
  });
  assert.deepEqual(cardBody("objective", { objective_id: 4, target_unit: "%", title: "O" }, { create: false }), {
    ogsm_objective: { title: "O" },
  });
});
