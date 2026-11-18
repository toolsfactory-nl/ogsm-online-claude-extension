import { test } from "node:test";
import assert from "node:assert/strict";
import { EnvironmentGate, exactHost, loadEnvironments, normaliseHost } from "../server/environments.js";

const TOKEN_A = "test-token-aaaa";
const TOKEN_B = "test-token-bbbb";

test("normaliseHost accepts bare hosts and URLs, and refuses plain http", () => {
  assert.deepEqual(normaliseHost("Klant.ogsm.online"), { host: "klant.ogsm.online", baseUrl: "https://klant.ogsm.online" });
  assert.deepEqual(normaliseHost("https://example.ogsm.online/teams"), {
    host: "example.ogsm.online",
    baseUrl: "https://example.ogsm.online",
  });
  assert.deepEqual(normaliseHost("http://localhost:8350"), { host: "localhost:8350", baseUrl: "http://localhost:8350" });
  assert.throws(() => normaliseHost("http://klant.ogsm.online"), /https/);
  assert.equal(normaliseHost(""), null);
});

test("loadEnvironments reads filled slots and skips empty or unexpanded ones", () => {
  const { environments, problems } = loadEnvironments({
    OGSM_ENV_1_HOST: "klant.ogsm.online",
    OGSM_ENV_1_TOKEN: TOKEN_A,
    OGSM_ENV_2_HOST: "${user_config.env_2_host}",
    OGSM_ENV_2_TOKEN: "${user_config.env_2_token}",
    OGSM_ENV_3_HOST: "",
    OGSM_ENV_3_TOKEN: "",
    OGSM_ENV_10_HOST: "example.ogsm.online",
    OGSM_ENV_10_TOKEN: TOKEN_B,
  });
  assert.deepEqual(
    environments.map((e) => [e.slot, e.host]),
    [
      [1, "klant.ogsm.online"],
      [10, "example.ogsm.online"],
    ]
  );
  assert.deepEqual(problems, []);
});

test("loadEnvironments reports incomplete and duplicate slots without leaking tokens", () => {
  const { environments, problems } = loadEnvironments({
    OGSM_ENV_1_HOST: "klant.ogsm.online",
    OGSM_ENV_1_TOKEN: TOKEN_A,
    OGSM_ENV_2_HOST: "https://klant.ogsm.online",
    OGSM_ENV_2_TOKEN: TOKEN_B,
    OGSM_ENV_3_HOST: "other.ogsm.online",
    OGSM_ENV_4_TOKEN: TOKEN_B,
  });
  assert.equal(environments.length, 1);
  assert.equal(problems.length, 3);
  for (const problem of problems) {
    assert.ok(!problem.includes(TOKEN_A) && !problem.includes(TOKEN_B));
  }
});

function gate() {
  const { environments } = loadEnvironments({
    OGSM_ENV_1_HOST: "klant.ogsm.online",
    OGSM_ENV_1_TOKEN: TOKEN_A,
    OGSM_ENV_2_HOST: "example.ogsm.online",
    OGSM_ENV_2_TOKEN: TOKEN_B,
  });
  return new EnvironmentGate(environments);
}

test("nothing is selected until select is called, and the key binds one environment", () => {
  const g = gate();
  assert.throws(() => g.require(undefined), /No OGSM.online environment is selected/);
  assert.throws(() => g.require("made-up"), /No OGSM.online environment is selected/);

  const { key, environment } = g.select("example.ogsm.online");
  assert.equal(environment.host, "example.ogsm.online");
  assert.equal(g.require(key).host, "example.ogsm.online");
});

test("select refuses an empty or unknown host without naming the configured ones", () => {
  const g = gate();
  for (const host of ["", undefined, "evil.example.com"]) {
    assert.throws(
      () => g.select(host),
      (error) => /not configured/.test(error.message) && !/ogsm\.online/.test(error.message)
    );
  }
});

test("current returns the environment of a valid key only", () => {
  const g = gate();
  assert.equal(g.current(undefined), null);
  assert.equal(g.current("made-up"), null);
  const { key } = g.select("klant.ogsm.online");
  assert.equal(g.current(key).host, "klant.ogsm.online");
});

test("a single configured environment is never selected automatically", () => {
  const { environments } = loadEnvironments({ OGSM_ENV_1_HOST: "klant.ogsm.online", OGSM_ENV_1_TOKEN: TOKEN_A });
  const g = new EnvironmentGate(environments);
  assert.throws(() => g.require(undefined), /No OGSM.online environment is selected/);
  assert.throws(() => g.select(undefined), /not configured/);
});

test("each conversation's key stays bound to its own choice", () => {
  const g = gate();
  const first = g.select("klant.ogsm.online");
  const second = g.select("example.ogsm.online");
  assert.notEqual(first.key, second.key);
  assert.equal(g.require(first.key).host, "klant.ogsm.online");
  assert.equal(g.require(second.key).host, "example.ogsm.online");
});

test("an idle selection expires", () => {
  let now = 0;
  const { environments } = loadEnvironments({ OGSM_ENV_1_HOST: "klant.ogsm.online", OGSM_ENV_1_TOKEN: TOKEN_A });
  const g = new EnvironmentGate(environments, { now: () => now, ttlMs: 1000 });
  const { key } = g.select("klant.ogsm.online");
  now = 999;
  assert.equal(g.require(key).host, "klant.ogsm.online");
  now = 1998;
  assert.equal(g.require(key).host, "klant.ogsm.online", "use extends the selection");
  now = 3000;
  assert.throws(() => g.require(key), /No OGSM.online environment is selected/);
});

test("exactHost only tidies case, spaces, the scheme and one trailing slash", () => {
  assert.equal(exactHost(" HTTPS://Klant.ogsm.online/ "), "klant.ogsm.online");
  assert.equal(exactHost("localhost:8350"), "localhost:8350");
  for (const value of ["klant.ogsm.online/teams", "klant.ogsm.online?x=1", "klant ogsm", "", undefined, 3]) {
    assert.equal(exactHost(value), null, String(value));
  }
});

test("selectTyped accepts an exact host only, and throttles misses", () => {
  let now = 0;
  const { environments } = loadEnvironments({
    OGSM_ENV_1_HOST: "klant.ogsm.online",
    OGSM_ENV_1_TOKEN: TOKEN_A,
  });
  const g = new EnvironmentGate(environments, { now: () => now, maxMisses: 2, missWindowMs: 1000 });
  assert.equal(g.selectTyped("Klant.ogsm.online").environment.host, "klant.ogsm.online");
  for (const miss of ["klant", "klant.ogsm.online.evil.com"]) {
    assert.throws(() => g.selectTyped(miss), (e) => /not one of/.test(e.message) && !/klant/.test(e.message));
  }
  assert.throws(() => g.selectTyped("klant.ogsm.online"), /Too many host names/);
  now = 1001;
  assert.equal(g.selectTyped("klant.ogsm.online").environment.host, "klant.ogsm.online");
});
