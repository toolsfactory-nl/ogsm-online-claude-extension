// Builds and sends requests to the OGSM.online v3 API with a personal API token.

export class ApiError extends Error {
  constructor(message, { status, error } = {}) {
    super(message);
    this.status = status;
    this.error = error;
  }
}

const USER_AGENT = "ogsm-online-claude-extension";

export function buildRequest(environment, method, path, { query, body } = {}) {
  const url = new URL(`/api/v3/${path.replace(/^\/+/, "")}`, environment.baseUrl);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${environment.token}`,
    "User-Agent": USER_AGENT,
  };
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return { url: url.toString(), init };
}

function settingsUrl(environment) {
  return `${environment.baseUrl}/my_settings/account`;
}

function parseJson(text) {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// 422 bodies are { field: ["message", ...] }; others are { error: "..." }.
function describeErrors(json) {
  if (!json || typeof json !== "object") return "";
  if (typeof json.error === "string") return json.error;
  return Object.entries(json)
    .map(([field, messages]) => `${field}: ${[].concat(messages).map((m) => (typeof m === "string" ? m : JSON.stringify(m))).join(", ")}`)
    .join("; ");
}

// Response text that is not an HTML page, shortened.
function plain(text) {
  return text && !text.trimStart().startsWith("<") ? text.slice(0, 500) : "";
}

export function errorFor(environment, status, text) {
  const json = parseJson(text);
  const error = json && typeof json.error === "string" ? json.error : undefined;
  const where = `${environment.host} answered ${status}`;
  switch (status) {
    case 401:
      return new ApiError(
        `${where}: the personal API token was refused (revoked, expired or not a personal API token). ` +
          `Create a new one under My settings → Personal API tokens on ${settingsUrl(environment)} and update ` +
          `the extension settings.`,
        { status, error }
      );
    case 403:
      if (error === "read_only_token") {
        return new ApiError(
          `${where} read_only_token: this token can only read, so it can not create, change or delete anything. ` +
            `Create a token with "Read and write" access under My settings → Personal API tokens on ` +
            `${settingsUrl(environment)} if the user wants to make changes.`,
          { status, error }
        );
      }
      if (error === "Personal authentication required") {
        return new ApiError(`${where}: this change needs a personal API token of a user.`, { status, error });
      }
      if (error === "comments_hidden") {
        return new ApiError(`${where} comments_hidden: the comments of this card are hidden for this user.`, {
          status,
          error,
        });
      }
      if (error === "api_disabled") {
        return new ApiError(`${where} api_disabled: the API is not enabled for this OGSM.online environment.`, {
          status,
          error,
        });
      }
      return new ApiError(`${where} forbidden: ${error || "the user is not allowed to do this"}.`, { status, error });
    case 400:
      if (error === "invalid_page") {
        return new ApiError(`${where} invalid_page: page must be a whole number from 1.`, { status, error });
      }
      return new ApiError(`${where} bad request: ${describeErrors(json) || "the request is incomplete"}.`, { status, error });
    case 404:
      // A JSON body names what is missing (e.g. "Goal Not Found"); an HTML page is a generic not found.
      return new ApiError(`${where} not found: ${error || "the record does not exist or is not visible to this user"}.`, {
        status,
        error,
      });
    case 422:
      return new ApiError(`${where} validation failed: ${describeErrors(json) || plain(text) || "unprocessable"}.`, {
        status,
        error: json,
      });
    case 429:
      return new ApiError(`${where} rate limited: ${error || "too many requests"}. Wait a few minutes and try again.`, {
        status,
        error,
      });
    default: {
      const detail = describeErrors(json) || plain(text);
      return new ApiError(`${where}${detail ? `: ${detail}` : ""}.`, { status, error });
    }
  }
}

export class OgsmClient {
  constructor(environment, { fetch: fetchImpl = globalThis.fetch } = {}) {
    this.environment = environment;
    this.fetch = fetchImpl;
  }

  async request(method, path, options = {}) {
    const { url, init } = buildRequest(this.environment, method, path, options);
    let response;
    try {
      response = await this.fetch(url, init);
    } catch (error) {
      throw new ApiError(`Could not reach ${this.environment.host}: ${error.message}`);
    }
    const text = await response.text();
    if (!response.ok) throw errorFor(this.environment, response.status, text);
    if (response.status === 204 || text.trim() === "") return null;
    const json = parseJson(text);
    if (json === undefined) throw new ApiError(`${this.environment.host} answered with something other than JSON.`);
    return json;
  }

  get(path, query) {
    return this.request("GET", path, { query });
  }

  post(path, body) {
    return this.request("POST", path, { body });
  }

  patch(path, body) {
    return this.request("PATCH", path, { body });
  }

  delete(path) {
    return this.request("DELETE", path);
  }

  // v3 indexes are paged: { data: [...], meta: { next_page } }.
  async getAll(path, query = {}, { maxPages = 50 } = {}) {
    const records = [];
    let page = 1;
    for (let count = 0; page && count < maxPages; count++) {
      const body = await this.get(path, { ...query, page });
      if (Array.isArray(body)) return records.concat(body);
      records.push(...(body?.data || []));
      page = body?.meta?.next_page || null;
    }
    return records;
  }
}
