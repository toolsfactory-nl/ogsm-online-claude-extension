// Tool definitions: every tool except select_environment needs the environment_session that
// select_environment returned in this conversation.

import { OgsmClient, ApiError } from "./api.js";
import { EnvironmentNotSelectedError } from "./environments.js";

const SESSION_PARAM = "environment_session";

const sessionSchema = {
  type: "string",
  description:
    "The environment_session that select_environment returned in this conversation.",
};

const id = (description) => ({ type: "integer", minimum: 1, description });
const text = (description) => ({ type: "string", description });
const html = (what) =>
  text(
    `${what}, as HTML. When editing, send back the full HTML you read (including its <img> tags), or attachments ` +
      "are lost. An <img> with a base64 data URI as src becomes an attachment (max 10 per request, 10 MB each)."
  );
const date = (what) => ({ type: "string", description: `${what} (YYYY-MM-DD)` });
const integer = (description) => ({ type: "integer", description });

const LABEL_IDS = {
  type: "array",
  items: { type: "string" },
  description:
    "Label names (or ids). Replaces the whole set of labels: [] clears them, omit to keep them. An unknown name " +
    "creates a label where allowed, otherwise it is dropped.",
};
const ASSIGNEE = {
  type: ["integer", "null"],
  minimum: 1,
  description: "Id of the user to assign (see list_users); null removes the assignee.",
};
const TRAFFIC_LIGHT = {
  type: ["string", "null"],
  description:
    'Traffic light in the language of the environment: nl "groen", "oranje", "rood"; en "green", "amber", "red". ' +
    'Clear it with "" or null, never with "leeg" or "empty". An unknown value silently clears it.',
};
const VALUE = (what) => ({
  type: ["number", "string", "null"],
  description: `${what}: a number or numeric string (e.g. 42 or "43,5"); null or "" erases it.`,
});
const PAGE = {
  type: "integer",
  minimum: 1,
  description: "Return only this page (1500 records, ordered by id) with its meta. Omit to get all records.",
};

const NO_MOVE = "A card can't be moved to another canvas or parent, nor deleted, via the API.";
const WRITE = "Needs a read and write token.";
const TL_NOTE = 'traffic_light: nl groen/oranje/rood, en green/amber/red; clear with "" or null, never "leeg".';
const EDIT_NOTE = "label_ids replaces the whole set; send an HTML description back in full.";

const MEASURE_PROPS = {
  target_unit: text("Unit of the measurements, e.g. % or EUR. A sub goal or sub indicator takes the one of its parent."),
  chart_vertical_min: { type: "number", description: "Lowest value of the chart axis." },
  aggregation_method: {
    type: "string",
    enum: [
      "sum",
      "average",
      "min",
      "max",
      "median",
      "none",
      "sum_per_quarter",
      "average_per_quarter",
      "sum_per_year",
      "average_per_year",
    ],
    description: "How measurements are aggregated. A sub goal or sub indicator takes the one of its parent.",
  },
  chart_type: {
    type: "string",
    enum: ["individual", "quarter_average", "quarter_sum", "year_average", "year_sum"],
  },
};

const CARD_PROPS = {
  title: text("Title"),
  description: html("Description"),
  assignee_id: ASSIGNEE,
  label_ids: LABEL_IDS,
};

const ACTION_PROPS = {
  title: text("Title"),
  description: html("Description"),
  start: date("Start date"),
  due: date("Due date. A backlog action that gets a date moves to todo."),
  list: text('Status: a status id, name or base key ("backlog", "todo", "doing", "done"); see list_statuses.'),
  effort: integer("Effort"),
  added_value: integer("Added value"),
  priority: { type: "string", enum: ["none", "low", "normal", "high", "very_high"] },
  budget_time_available: integer("Available time budget"),
  budget_money_available: integer("Available money budget"),
  assignee_id: ASSIGNEE,
  label_ids: LABEL_IDS,
};
const ACTION_KEYS = Object.keys(ACTION_PROPS);

const MEASUREMENT_PROPS = {
  at: date("Date of the measurement"),
  current_value: VALUE("Measured value"),
  target_value: VALUE("Target value"),
  traffic_light: TRAFFIC_LIGHT,
  show_in_ogsm: { type: "boolean", description: "Show this measurement on the OGSM." },
};
const MEASUREMENT_KEYS = Object.keys(MEASUREMENT_PROPS);

function schema(properties, required = []) {
  return {
    type: "object",
    properties: { [SESSION_PARAM]: sessionSchema, ...properties },
    required: [SESSION_PARAM, ...required],
    additionalProperties: false,
  };
}

function pathId(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new ApiError(`${name} must be a positive integer id`);
  return number;
}

function uuid(value, name) {
  if (typeof value !== "string" || !/^[0-9a-f-]{8,64}$/i.test(value)) throw new ApiError(`${name} must be a batch id (UUID)`);
  return value;
}

// Copies the given keys from args to body when present, renaming via the map.
function pick(args, keys, rename = {}) {
  const body = {};
  for (const key of keys) {
    if (args[key] !== undefined) body[rename[key] || key] = args[key];
  }
  return body;
}

function requireChanges(body) {
  if (Object.keys(body).length === 0) throw new ApiError("Nothing to change: pass at least one field to update.");
  return body;
}

export function actionBody(args, { create }) {
  const body = pick(args, ACTION_KEYS);
  if (create) {
    body.canvas = { id: pathId(args.canvas_id, "canvas_id") };
    if (args.strategy_id !== undefined) body.strategy = { id: pathId(args.strategy_id, "strategy_id") };
    return { ogsm_action: body };
  }
  return { ogsm_action: requireChanges(body) };
}

// kind: objective | goal | strategy | indicator
export function cardBody(kind, args, { create }) {
  const measured = kind === "goal" || kind === "indicator";
  const keys = Object.keys(CARD_PROPS);
  if (measured) keys.push(...Object.keys(MEASURE_PROPS));
  const body = pick(args, keys);
  if (create) {
    body.canvas = { id: pathId(args.canvas_id, "canvas_id") };
    if (measured && args.parent_id !== undefined) body.parent = { id: pathId(args.parent_id, "parent_id") };
    return { [`ogsm_${kind}`]: body };
  }
  return { [`ogsm_${kind}`]: requireChanges(body) };
}

// kind: goal | indicator
export function measurementBody(kind, args, { create }) {
  const body = pick(args, MEASUREMENT_KEYS);
  if (create) {
    body[kind] = { id: pathId(args[`${kind}_id`], `${kind}_id`) };
    return { [`${kind}_report`]: body };
  }
  return { [`${kind}_report`]: requireChanges(body) };
}

export const MAX_BATCH_OPERATIONS = 500;

// kind: goal | indicator
export function batchBody(kind, args) {
  const operations = args.operations;
  if (!Array.isArray(operations) || operations.length === 0) throw new ApiError("operations must be a non-empty array");
  if (operations.length > MAX_BATCH_OPERATIONS) {
    throw new ApiError(`A batch holds at most ${MAX_BATCH_OPERATIONS} operations; split it into several batches.`);
  }
  return {
    [`${kind}_report_batch`]: {
      operations: operations.map((operation, index) => {
        const op = operation?.op;
        if (!["create", "update", "delete"].includes(op)) {
          throw new ApiError(`operations[${index}].op must be create, update or delete`);
        }
        const out = { op };
        if (op === "create") {
          out[kind] = { id: pathId(operation[`${kind}_id`], `operations[${index}].${kind}_id`) };
        } else {
          out.id = pathId(operation.id, `operations[${index}].id`);
        }
        if (op !== "delete") Object.assign(out, pick(operation, MEASUREMENT_KEYS));
        return out;
      }),
    },
  };
}

function onCanvas(canvasId) {
  if (canvasId === undefined) return (records) => records;
  const wanted = pathId(canvasId, "canvas_id");
  return (records) => records.filter((r) => (r.ogsm_canvases || []).some((c) => c.id === wanted));
}

function ofRecord(kind, value) {
  if (value === undefined) return (records) => records;
  const wanted = pathId(value, `${kind}_id`);
  return (records) => records.filter((r) => r[kind]?.id === wanted);
}

// All pages, or only args.page with its meta ({ data, meta }). `filter` narrows the records client side.
async function list(client, path, args, { query = {}, filter = (records) => records } = {}) {
  if (args.page === undefined) return filter(await client.getAll(path, query));
  const page = pathId(args.page, "page");
  const body = await client.get(path, { ...query, page });
  if (Array.isArray(body)) return filter(body);
  return { data: filter(body?.data || []), meta: body?.meta };
}

const an = (kind) => (/^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`);

const PLURAL = { objective: "objectives", goal: "goals", strategy: "strategies", indicator: "indicators", action: "actions" };

const READ = { readOnlyHint: true };
const WRITES = { readOnlyHint: false, destructiveHint: false };
const DELETES = { readOnlyHint: false, destructiveHint: true };

function cardTools(kind) {
  const plural = PLURAL[kind];
  const measured = kind === "goal" || kind === "indicator";
  const props = measured ? { ...CARD_PROPS, ...MEASURE_PROPS } : CARD_PROPS;
  const createProps = { canvas_id: id(`Id of the canvas (OGSM) the ${kind} belongs to.`), ...props };
  const createRequired = ["canvas_id", "title"];
  let placement = `${an(kind)[0].toUpperCase()}${an(kind).slice(1)} takes no parent.`;
  if (kind === "goal") {
    createProps.parent_id = id("Optional id of a goal on the same canvas, to make this a sub goal.");
    placement = "Optional parent_id: a goal on the same canvas, for a sub goal.";
  } else if (kind === "indicator") {
    createProps.parent_id = id(
      "Id of a strategy on the same canvas, or of an indicator there to make this a sub indicator."
    );
    createRequired.push("parent_id");
    placement = "parent_id is required: a strategy on the same canvas, or an indicator there for a sub indicator.";
  }
  return [
    {
      name: `list_${plural}`,
      description: `List the ${plural} visible to the user, optionally only those on one canvas.`,
      annotations: READ,
      inputSchema: schema({ canvas_id: id("Only return records on this canvas."), page: PAGE }),
      run: (client, args) => list(client, `${plural}.json`, args, { filter: onCanvas(args.canvas_id) }),
    },
    {
      name: `create_${kind}`,
      description: `Create ${an(kind)} on a canvas. ${placement} The canvas and parent can't be changed later. ${WRITE}`,
      annotations: WRITES,
      inputSchema: schema(createProps, createRequired),
      run: (client, args) => client.post(`${plural}.json`, cardBody(kind, args, { create: true })),
    },
    {
      name: `update_${kind}`,
      description: `Update ${an(kind)}; only the fields passed change. ${EDIT_NOTE} ${NO_MOVE} ${WRITE}`,
      annotations: WRITES,
      inputSchema: schema({ [`${kind}_id`]: id(`Id of the ${kind}.`), ...props }, [`${kind}_id`]),
      run: (client, args) =>
        client.patch(`${plural}/${pathId(args[`${kind}_id`], `${kind}_id`)}.json`, cardBody(kind, args, { create: false })),
    },
  ];
}

const REPORT_FIELDS = {
  objective: "traffic light, description and decision",
  strategy: "traffic light, description and decision",
  action: "traffic light, progress, status, used budgets, description and decision",
  goal: "current and target value, traffic light, show_in_ogsm, description and decision",
  indicator: "current and target value, traffic light, show_in_ogsm, description and decision",
};

function reportListTool(kind) {
  return {
    name: `list_${kind}_reports`,
    description:
      `List the ${kind} reports (${REPORT_FIELDS[kind]}; kind current, aggregation, impose_down, imposed or ` +
      `target), optionally of one ${kind}. Values and traffic lights are in the language of the environment.`,
    annotations: READ,
    inputSchema: schema({ [`${kind}_id`]: id(`Only return reports of this ${kind}.`), page: PAGE }),
    run: (client, args) => list(client, `${kind}_reports.json`, args, { filter: ofRecord(kind, args[`${kind}_id`]) }),
  };
}

// Single measurements and batches of goals or indicators.
function measurementTools(kind) {
  const path = `${kind}_reports`;
  const reportId = `${kind}_report_id`;
  const batchPath = `${kind}_report_batches`;
  const operation = {
    type: "object",
    properties: {
      op: { type: "string", enum: ["create", "update", "delete"] },
      id: id(`Id of the ${kind} report (update and delete).`),
      [`${kind}_id`]: id(`Id of the ${kind} (create).`),
      ...MEASUREMENT_PROPS,
    },
    required: ["op"],
    additionalProperties: false,
  };
  return [
    {
      name: `create_${kind}_report`,
      description:
        `Add a measurement to ${an(kind)}. at is required; description, decision and kind can't be set. ${TL_NOTE} ${WRITE}`,
      annotations: WRITES,
      inputSchema: schema({ [`${kind}_id`]: id(`Id of the ${kind}.`), ...MEASUREMENT_PROPS }, [`${kind}_id`, "at"]),
      run: (client, args) => client.post(`${path}.json`, measurementBody(kind, args, { create: true })),
    },
    {
      name: `update_${kind}_report`,
      description: `Change a measurement of ${an(kind)}; only the fields passed change. ${TL_NOTE} ${WRITE}`,
      annotations: WRITES,
      inputSchema: schema({ [reportId]: id(`Id of the ${kind} report.`), ...MEASUREMENT_PROPS }, [reportId]),
      run: (client, args) =>
        client.patch(`${path}/${pathId(args[reportId], reportId)}.json`, measurementBody(kind, args, { create: false })),
    },
    {
      name: `delete_${kind}_report`,
      description: `Delete a measurement of ${an(kind)}. ${WRITE}`,
      annotations: DELETES,
      inputSchema: schema({ [reportId]: id(`Id of the ${kind} report.`) }, [reportId]),
      run: async (client, args) => {
        const reportIdValue = pathId(args[reportId], reportId);
        return (await client.delete(`${path}/${reportIdValue}.json`)) ?? { deleted: reportIdValue };
      },
    },
    {
      name: `create_${kind}_report_batch`,
      description:
        `Create, update and delete up to ${MAX_BATCH_OPERATIONS} ${kind} measurements in one asynchronous batch. ` +
        `Each operation: op create (${kind}_id, at, values), update (id, values) or delete (id). Returns the queued ` +
        `batch; poll get_${kind}_report_batch for the per-operation results. At most 5 batches per 5 minutes. ${TL_NOTE} ${WRITE}`,
      annotations: DELETES,
      inputSchema: schema(
        { operations: { type: "array", minItems: 1, maxItems: MAX_BATCH_OPERATIONS, items: operation } },
        ["operations"]
      ),
      run: (client, args) => client.post(`${batchPath}.json`, batchBody(kind, args)),
    },
    {
      name: `get_${kind}_report_batch`,
      description:
        `Get the status (queued, processing, completed, failed) and per-operation results of one of the user's ` +
        `${kind} report batches.`,
      annotations: READ,
      inputSchema: schema({ batch_id: text("Id (UUID) of the batch.") }, ["batch_id"]),
      run: (client, args) => client.get(`${batchPath}/${uuid(args.batch_id, "batch_id")}.json`),
    },
  ];
}

const commentPath = (args) => `actions/${pathId(args.action_id, "action_id")}/comments`;
const COMMENT_CARD = id("Id of the card (an action, or any other card you can see).");

export const API_TOOLS = [
  {
    name: "list_canvases",
    description: "List the OGSM canvases the user can see, with their team id and status (draft, active, archived).",
    annotations: READ,
    inputSchema: schema({ page: PAGE }),
    run: (client, args) => list(client, "ogsm_canvases.json", args),
  },
  {
    name: "list_teams",
    description: "List the teams the user belongs to.",
    annotations: READ,
    inputSchema: schema({ page: PAGE }),
    run: (client, args) => list(client, "teams.json", args),
  },
  {
    name: "list_users",
    description: "List the users in the user's teams (id, name, email address), e.g. to find an assignee id.",
    annotations: READ,
    inputSchema: schema({ page: PAGE }),
    run: (client, args) => list(client, "users.json", args),
  },
  {
    name: "list_statuses",
    description: "List the statuses an action can have (id, name, base list), for the list field of an action.",
    annotations: READ,
    inputSchema: schema({ page: PAGE }),
    run: (client, args) => list(client, "statuses.json", args),
  },
  {
    name: "list_actions",
    description: "List the actions visible to the user, optionally only those on one canvas.",
    annotations: READ,
    inputSchema: schema({ canvas_id: id("Only return actions on this canvas (see list_canvases)."), page: PAGE }),
    run: (client, args) =>
      list(client, "actions.json", args, {
        query: { canvas_id: args.canvas_id === undefined ? undefined : pathId(args.canvas_id, "canvas_id") },
      }),
  },
  {
    name: "create_action",
    description:
      "Create an action on a canvas, optionally under a strategy (or under another action). The canvas and " +
      `strategy can't be changed later. Progress, involved, recurring and custom fields can't be set. ${WRITE}`,
    annotations: WRITES,
    inputSchema: schema(
      {
        canvas_id: id("Id of the canvas the action belongs to."),
        strategy_id: id("Optional id of a strategy on that canvas, or of an action there to make this an underlying action."),
        ...ACTION_PROPS,
      },
      ["canvas_id", "title"]
    ),
    run: (client, args) => client.post("actions.json", actionBody(args, { create: true })),
  },
  {
    name: "update_action",
    description: `Update an action; only the fields passed change. ${EDIT_NOTE} ${NO_MOVE} ${WRITE}`,
    annotations: WRITES,
    inputSchema: schema({ action_id: id("Id of the action."), ...ACTION_PROPS }, ["action_id"]),
    run: (client, args) =>
      client.patch(`actions/${pathId(args.action_id, "action_id")}.json`, actionBody(args, { create: false })),
  },
  {
    name: "list_comments",
    description: "List the comments on a card.",
    annotations: READ,
    inputSchema: schema({ action_id: COMMENT_CARD, page: PAGE }, ["action_id"]),
    run: (client, args) => list(client, `${commentPath(args)}.json`, args),
  },
  {
    name: "create_comment",
    description: `Add a comment to a card. ${WRITE}`,
    annotations: WRITES,
    inputSchema: schema({ action_id: COMMENT_CARD, content: html("Comment") }, ["action_id", "content"]),
    run: (client, args) => client.post(`${commentPath(args)}.json`, { comment: { content: args.content } }),
  },
  {
    name: "update_comment",
    description: `Replace the content of a comment (own comment, or any as tenant admin); send the full HTML. ${WRITE}`,
    annotations: WRITES,
    inputSchema: schema({ action_id: COMMENT_CARD, comment_id: id("Id of the comment."), content: html("Comment") }, [
      "action_id",
      "comment_id",
      "content",
    ]),
    run: (client, args) =>
      client.patch(`${commentPath(args)}/${pathId(args.comment_id, "comment_id")}.json`, {
        comment: { content: args.content },
      }),
  },
  {
    name: "delete_comment",
    description: `Delete one of the user's own comments on a card. ${WRITE}`,
    annotations: DELETES,
    inputSchema: schema({ action_id: COMMENT_CARD, comment_id: id("Id of the comment.") }, ["action_id", "comment_id"]),
    run: async (client, args) => {
      const commentId = pathId(args.comment_id, "comment_id");
      return (await client.delete(`${commentPath(args)}/${commentId}.json`)) ?? { deleted: commentId };
    },
  },
  ...cardTools("objective"),
  ...cardTools("goal"),
  ...cardTools("strategy"),
  ...cardTools("indicator"),
  ...["objective", "strategy", "action", "goal", "indicator"].map(reportListTool),
  ...measurementTools("goal"),
  ...measurementTools("indicator"),
];

export const SERVER_INSTRUCTIONS = `This server works with one OGSM.online environment per conversation. Before any other
tool, call select_environment with environment_session null. The user then chooses the environment, either in a
form of their own or by answering your question. You do not know which environments exist and you never choose one:
when select_environment asks you to, ask the user one short question in their language, such as "In welke
OGSM.online-omgeving wil je werken?", with no explanation, apology or technical detail, and pass on literally what
they typed, without suggesting, guessing or completing a host name. You get back only the chosen environment and an
environment_session. Pass that environment_session to every other tool. Work only in the selected environment for
the whole conversation. Never mention, suggest, guess or compare any other environment, and never offer to repeat
work elsewhere. Never reuse an environment_session or a host name from another conversation. If the user wants
another environment, tell them to start a new conversation.`;

const GATE_TOOLS = [
  {
    name: "select_environment",
    description:
      "Let the user choose the OGSM.online environment for this conversation. Pass environment_session null the " +
      "first time, without host. The user then picks the environment in a form of their own, or, if that form is " +
      "not available, the result tells you to ask the user: then ask one short question in their language (e.g. " +
      "\"In welke OGSM.online-omgeving wil je werken?\") without explaining why, wait for their answer and call " +
      "again with host set to exactly what they typed. You do not see the options and never choose or suggest " +
      "one. If this " +
      "conversation already has an environment_session, pass it (it is then refused, as a conversation works in " +
      "one environment only). Returns the chosen environment and the environment_session for every other tool.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        [SESSION_PARAM]: {
          type: ["string", "null"],
          description: "The environment_session this conversation already has, or null when it has none.",
        },
        host: {
          type: "string",
          description:
            "Only after select_environment told you to ask the user: the host name exactly as the user typed it " +
            "in this conversation in reply to your question. Never a host you suggested, guessed, completed or " +
            "remember from elsewhere. Leave it out otherwise.",
        },
      },
      required: [SESSION_PARAM],
      additionalProperties: false,
    },
  },
];

export function toolList() {
  return [...GATE_TOOLS, ...API_TOOLS].map(({ name, description, inputSchema, annotations }) => ({
    name,
    description,
    inputSchema,
    annotations,
  }));
}

function ok(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

export const NEW_CONVERSATION = "Start a new conversation to work with another environment.";

export const ASK_USER =
  "No OGSM.online environment is selected yet. In your next message, ask the user only this one short question, " +
  "in their language, e.g. \"In welke OGSM.online-omgeving wil je werken?\" or \"Which OGSM.online environment " +
  "do you want to work in?\" Say nothing else about it: no explanation, no apology, and do not mention a " +
  "picker, form, host name or https://. Do not suggest, guess, list or complete a host name, give no example, " +
  "and do not use one from another conversation. When the user has answered, call select_environment again " +
  "with environment_session null and host set to exactly what the user typed.";

// Dispatches one tool call. `pick(names)` asks the user to choose in a form (MCP elicitation)
// and resolves to { host } or { problem }; `canPick()` tells whether that form is available.
// The model never sees the configured hosts.
export async function callTool(name, args = {}, { gate, fetch, pick, canPick } = {}) {
  args = args || {};
  try {
    if (name === "select_environment") return await selectEnvironment(args, { gate, pick, canPick });
    const tool = API_TOOLS.find((t) => t.name === name);
    if (!tool) return fail(`Unknown tool: ${name}`);
    const environment = gate.require(args[SESSION_PARAM]);
    const client = new OgsmClient(environment, fetch ? { fetch } : {});
    const data = await tool.run(client, args);
    return ok({ environment: environment.host, data });
  } catch (error) {
    if (error instanceof EnvironmentNotSelectedError || error instanceof ApiError) return fail(error.message);
    return fail(`Unexpected error: ${error.message}`);
  }
}

function selected({ key, environment }) {
  return ok({
    environment: environment.host,
    [SESSION_PARAM]: key,
    note: "Pass this environment_session to every other tool. Work only in this environment for the rest of this conversation.",
  });
}

async function selectEnvironment(args, { gate, pick, canPick }) {
  const extra = Object.keys(args).filter((key) => key !== SESSION_PARAM && key !== "host");
  const typed = args.host;
  if (extra.length || !(SESSION_PARAM in args) || (typed !== undefined && typeof typed !== "string")) {
    return fail(
      "select_environment takes environment_session (null when this conversation has none yet, otherwise the " +
        "one it has) and, only when it asked you to, host as the user typed it. The user chooses the environment."
    );
  }
  const existing = gate.current(args[SESSION_PARAM]);
  if (existing) {
    return fail(`This conversation already works in ${existing.host}; it works in one environment only. ${NEW_CONVERSATION}`);
  }
  if (gate.names().length === 0) {
    return fail(
      "No OGSM.online environment is configured. Ask the user to add a host and personal API token in the " +
        "extension settings (Settings → Extensions)."
    );
  }
  const pickerAvailable = Boolean(pick && (canPick ? canPick() : true));
  if (typed !== undefined) {
    if (pickerAvailable) {
      return fail(
        "Do not pass host: the user chooses the environment in a picker. Call select_environment with only " +
          "environment_session null."
      );
    }
    return selected(gate.selectTyped(typed));
  }
  const result = pickerAvailable ? await pick(gate.names()) : { problem: "unsupported" };
  if (result.problem === "unsupported" || result.problem === "failed") {
    return ok({ environment: null, [SESSION_PARAM]: null, next_step: ASK_USER });
  }
  if (result.problem) {
    return fail("The user did not choose an environment, so no OGSM.online tool can be used in this conversation.");
  }
  return selected(gate.select(result.host));
}
