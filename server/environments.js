// Reads the environment slots that Claude Desktop passes in from the extension settings
// (manifest.json user_config → server.mcp_config.env), and keeps the per-conversation selection.

import { randomBytes } from "node:crypto";

export const SLOT_COUNT = 10;

// Claude Desktop may pass an unfilled optional setting as an empty string or leave the
// "${user_config.KEY}" placeholder unexpanded; both mean "not configured".
function configured(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed === "" || /^\$\{user_config\.[^}]*\}$/.test(trimmed)) return "";
  return trimmed;
}

// Accepts "klant.ogsm.online", "https://klant.ogsm.online/" or a full URL with a path, and
// returns the bare host (plus port) and its https base URL. Plain http is only allowed for
// localhost, for development against a local server.
export function normaliseHost(value) {
  const raw = configured(value);
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new Error(`"${raw}" is not a valid host name`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(`"${raw}" must use https`);
  }
  if (!url.hostname) throw new Error(`"${raw}" is not a valid host name`);
  return { host: url.host.toLowerCase(), baseUrl: `${url.protocol}//${url.host.toLowerCase()}` };
}

// Returns { environments: [{ host, baseUrl, token, slot }], problems: [string] }.
// Problems never contain a token.
export function loadEnvironments(env = process.env, slots = SLOT_COUNT) {
  const environments = [];
  const problems = [];
  const seen = new Set();
  for (let slot = 1; slot <= slots; slot++) {
    const hostValue = configured(env[`OGSM_ENV_${slot}_HOST`]);
    const token = configured(env[`OGSM_ENV_${slot}_TOKEN`]);
    if (!hostValue && !token) continue;
    if (!hostValue) {
      problems.push(`Environment ${slot} has a token but no host`);
      continue;
    }
    if (!token) {
      problems.push(`Environment ${slot} (${hostValue}) has no personal API token`);
      continue;
    }
    let normalised;
    try {
      normalised = normaliseHost(hostValue);
    } catch (error) {
      problems.push(`Environment ${slot}: ${error.message}`);
      continue;
    }
    if (seen.has(normalised.host)) {
      problems.push(`Environment ${slot} (${normalised.host}) repeats an earlier environment and is ignored`);
      continue;
    }
    seen.add(normalised.host);
    environments.push({ ...normalised, token, slot });
  }
  return { environments, problems };
}

export class EnvironmentNotSelectedError extends Error {}

// The MCP server process lives as long as Claude Desktop runs and is shared by every
// conversation, so a process-wide "current environment" would leak from one chat into the
// next. Instead, each selection hands out a random session key that is bound to one
// environment. Every other tool needs that key; it only exists in the transcript of the
// conversation where the user made the choice, so a new conversation has to select (and so
// ask) again. A conversation works in one environment only: select_environment refuses while
// the key it is given is still valid.
export class EnvironmentGate {
  constructor(environments, { now = () => Date.now(), ttlMs = 12 * 60 * 60 * 1000 } = {}) {
    this.environments = environments;
    this.now = now;
    this.ttlMs = ttlMs;
    this.sessions = new Map();
  }

  names() {
    return this.environments.map((e) => e.host);
  }

  find(host) {
    let normalised;
    try {
      normalised = normaliseHost(host);
    } catch {
      return null;
    }
    if (!normalised) return null;
    return this.environments.find((e) => e.host === normalised.host) || null;
  }

  // Only called with the host the user picked; the error never names other environments.
  select(host) {
    const environment = typeof host === "string" ? this.find(host) : null;
    if (!environment) throw new EnvironmentNotSelectedError("The chosen environment is not configured.");
    this.prune();
    const key = randomBytes(12).toString("base64url");
    this.sessions.set(key, { host: environment.host, expiresAt: this.now() + this.ttlMs });
    return { key, environment };
  }

  // Returns the environment bound to a still valid key, or null. Does not extend the key.
  current(key) {
    this.prune();
    const session = typeof key === "string" ? this.sessions.get(key) : undefined;
    if (!session) return null;
    return this.environments.find((e) => e.host === session.host) || null;
  }

  // Returns the environment bound to the key, or throws when there is none.
  require(key) {
    const environment = this.current(key);
    if (!environment) {
      throw new EnvironmentNotSelectedError(
        "No OGSM.online environment is selected in this conversation. Call select_environment (with " +
          "environment_session null); the user then chooses the environment. Pass the returned " +
          "environment_session to this tool."
      );
    }
    this.sessions.get(key).expiresAt = this.now() + this.ttlMs;
    return environment;
  }

  prune() {
    const now = this.now();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
  }
}
