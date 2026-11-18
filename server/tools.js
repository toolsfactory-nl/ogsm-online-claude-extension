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
  text(`${what}, as HTML. An <img> with a base64 data URI as its src is stored as an attachment.`);
const labels = {
  type: "array",
  items: { type: "string" },
  description: "Label names. Replaces the labels the card has.",
};
const date = (what) => ({ type: "string", description: `${what} (YYYY-MM-DD)` });

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
  assignee_id: id("Id of the user to assign (see list_users)."),
  labels,
};

const ACTION_PROPS = {
  title: text("Title"),
  description: html("Description"),
  start: date("Start date"),
  due: date("Due date"),
  status: text('Status: a status id, name or base list key ("backlog", "todo", "doing", "done"); see list_statuses.'),
  effort: text("Effort"),
  added_value: text("Added value"),
  priority: text("Priority"),
  budget_time_available: { type: "number", description: "Available time budget" },
  budget_money_available: { type: "number", description: "Available money budget" },
  assignee_id: id("Id of the user to assign (see list_users)."),
  labels,
};

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
  const body = pick(
    args,
    [
      "title",
      "description",
      "start",
      "due",
      "status",
      "effort",
      "added_value",
      "priority",
      "budget_time_available",
      "budget_money_available",
      "assignee_id",
      "labels",
    ],
    { status: "list", labels: "label_ids" }
  );
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
  const keys = ["title", "description", "assignee_id", "labels"];
  if (measured) keys.push(...Object.keys(MEASURE_PROPS));
  const body = pick(args, keys, { labels: "label_ids" });
  if (create) {
    body.canvas = { id: pathId(args.canvas_id, "canvas_id") };
    if ((kind === "goal" || kind === "indicator") && args.parent_id !== undefined) {
      body.parent = { id: pathId(args.parent_id, "parent_id") };
    }
    return { [`ogsm_${kind}`]: body };
  }
  return { [`ogsm_${kind}`]: requireChanges(body) };
}

function onCanvas(records, canvasId) {
  if (canvasId === undefined) return records;
  const wanted = pathId(canvasId, "canvas_id");
  return records.filter((r) => (r.ogsm_canvases || []).some((c) => c.id === wanted));
}

const an = (kind) => (/^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`);

const PLURAL = { objective: "objectives", goal: "goals", strategy: "strategies", indicator: "indicators" };

function cardTools(kind) {
  const plural = PLURAL[kind];
  const measured = kind === "goal" || kind === "indicator";
  const props = measured ? { ...CARD_PROPS, ...MEASURE_PROPS } : CARD_PROPS;
  const createProps = { canvas_id: id(`Id of the canvas (OGSM) the ${kind} belongs to.`), ...props };
  const createRequired = ["canvas_id", "title"];
  let placement = `An ${kind} stands on the OGSM itself and takes no parent.`;
  if (kind === "goal") {
    createProps.parent_id = id("Optional id of a goal on the same canvas, to make this a sub goal.");
    placement = "Pass parent_id (a goal on the same canvas) to make it a sub goal.";
  } else if (kind === "indicator") {
    createProps.parent_id = id(
      "Id of a strategy on the same canvas, or of an indicator there to make this a sub indicator."
    );
    createRequired.push("parent_id");
    placement = "parent_id is required: a strategy on the same canvas, or an indicator there for a sub indicator.";
  } else if (kind === "strategy") {
    placement = "A strategy stands on the OGSM itself and takes no parent.";
  }
  return [
    {
      name: `list_${plural}`,
      description: `List the ${plural} visible to the user, optionally only those on one canvas.`,
      annotations: { readOnlyHint: true },
      inputSchema: schema({ canvas_id: id("Only return records on this canvas.") }),
      run: async (client, args) => onCanvas(await client.getAll(`${plural}.json`), args.canvas_id),
    },
    {
      name: `create_${kind}`,
      description: `Create ${an(kind)} on a canvas. ${placement} Needs a read and write token.`,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: schema(createProps, createRequired),
      run: (client, args) => client.post(`${plural}.json`, cardBody(kind, args, { create: true })),
    },
    {
      name: `update_${kind}`,
      description: `Update ${an(kind)}. Only the fields passed are changed. Needs a read and write token.`,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: schema({ [`${kind}_id`]: id(`Id of the ${kind}.`), ...props }, [`${kind}_id`]),
      run: (client, args) =>
        client.patch(`${plural}/${pathId(args[`${kind}_id`], `${kind}_id`)}.json`, cardBody(kind, args, { create: false })),
    },
  ];
}

function reportTools(kind) {
  return {
    name: `list_${kind}_reports`,
    description: `List the measurements (reports) of ${kind}s, optionally of one ${kind}.`,
    annotations: { readOnlyHint: true },
    inputSchema: schema({ [`${kind}_id`]: id(`Only return reports of this ${kind}.`) }),
    run: async (client, args) => {
      const records = await client.getAll(`${kind}_reports.json`);
      if (args[`${kind}_id`] === undefined) return records;
      const wanted = pathId(args[`${kind}_id`], `${kind}_id`);
      return records.filter((r) => r[kind]?.id === wanted);
    },
  };
}

export const API_TOOLS = [
  {
    name: "list_canvases",
    description: "List the OGSM canvases the user can see, with their team id and status.",
    annotations: { readOnlyHint: true },
    inputSchema: schema({}),
    run: (client) => client.getAll("ogsm_canvases.json"),
  },
  {
    name: "list_teams",
    description: "List the teams the user belongs to.",
    annotations: { readOnlyHint: true },
    inputSchema: schema({}),
    run: (client) => client.getAll("teams.json"),
  },
  {
    name: "list_users",
    description: "List the users in the user's teams (id, name, email address), e.g. to find an assignee id.",
    annotations: { readOnlyHint: true },
    inputSchema: schema({}),
    run: (client) => client.getAll("users.json"),
  },
  {
    name: "list_statuses",
    description: "List the statuses an action can have, in board column order.",
    annotations: { readOnlyHint: true },
    inputSchema: schema({}),
    run: (client) => client.getAll("statuses.json"),
  },
  {
    name: "list_actions",
    description: "List the actions on a canvas.",
    annotations: { readOnlyHint: true },
    inputSchema: schema({ canvas_id: id("Id of the canvas (see list_canvases).") }, ["canvas_id"]),
    run: (client, args) => client.getAll("actions.json", { canvas_id: pathId(args.canvas_id, "canvas_id") }),
  },
  {
    name: "create_action",
    description:
      "Create an action on a canvas, optionally under a strategy (or under another action). Needs a read and write token.",
    annotations: { readOnlyHint: false, destructiveHint: false },
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
    description: "Update an action. Only the fields passed are changed. Needs a read and write token.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: schema({ action_id: id("Id of the action."), ...ACTION_PROPS }, ["action_id"]),
    run: (client, args) =>
      client.patch(`actions/${pathId(args.action_id, "action_id")}.json`, actionBody(args, { create: false })),
  },
  {
    name: "list_comments",
    description: "List the comments on an action.",
    annotations: { readOnlyHint: true },
    inputSchema: schema({ action_id: id("Id of the action.") }, ["action_id"]),
    run: (client, args) => client.getAll(`actions/${pathId(args.action_id, "action_id")}/comments.json`),
  },
  {
    name: "create_comment",
    description: "Add a comment to an action. Needs a read and write token.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: schema({ action_id: id("Id of the action."), content: html("Comment") }, ["action_id", "content"]),
    run: (client, args) =>
      client.post(`actions/${pathId(args.action_id, "action_id")}/comments.json`, {
        comment: { content: args.content },
      }),
  },
  {
    name: "update_comment",
    description: "Change the content of a comment on an action. Needs a read and write token.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: schema(
      { action_id: id("Id of the action."), comment_id: id("Id of the comment."), content: html("Comment") },
      ["action_id", "comment_id", "content"]
    ),
    run: (client, args) =>
      client.patch(
        `actions/${pathId(args.action_id, "action_id")}/comments/${pathId(args.comment_id, "comment_id")}.json`,
        { comment: { content: args.content } }
      ),
  },
  {
    name: "delete_comment",
    description: "Delete one of the user's own comments on an action. Needs a read and write token.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: schema({ action_id: id("Id of the action."), comment_id: id("Id of the comment.") }, [
      "action_id",
      "comment_id",
    ]),
    run: async (client, args) => {
      const commentId = pathId(args.comment_id, "comment_id");
      const result = await client.delete(`actions/${pathId(args.action_id, "action_id")}/comments/${commentId}.json`);
      return result ?? { deleted: commentId };
    },
  },
  ...cardTools("objective"),
  ...cardTools("goal"),
  ...cardTools("strategy"),
  ...cardTools("indicator"),
  reportTools("goal"),
  reportTools("indicator"),
];

export const SERVER_INSTRUCTIONS = `This server works with one OGSM.online environment per conversation. Before any other
tool, call select_environment with environment_session null. The user then chooses the environment, either in a
form of their own or, when that form is not available, by typing its host name in reply to your question. You do
not know which environments exist and you never choose one: when select_environment asks you to, ask the user
which environment they mean and pass on literally what they typed, without suggesting, guessing or completing a
host name. You get back only the chosen environment and an environment_session. Pass that environment_session to
every other tool. Work only in the selected environment for the whole conversation. Never mention, suggest,
guess or compare any other environment, and never offer to repeat work elsewhere. Never reuse an
environment_session or a host name from another conversation. If the user wants another environment, tell them to
start a new conversation.`;

const GATE_TOOLS = [
  {
    name: "select_environment",
    description:
      "Let the user choose the OGSM.online environment for this conversation. Pass environment_session null the " +
      "first time, without host. The user then picks the environment in a form of their own, or, if that form is " +
      "not available, the result tells you to ask the user: then ask, wait for their answer and call again with " +
      "host set to exactly what they typed. You do not see the options and never choose or suggest one. If this " +
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
  "No OGSM.online environment is selected yet, and this app cannot show the environment picker. Ask the user, " +
  "in your next message, which OGSM.online environment they want to work in in this conversation, by its host " +
  "name as they know it (the address they open OGSM.online on, without https://). Only ask: do not suggest, " +
  "guess, list or complete a host name, and do not use one from another conversation. When the user has " +
  "answered, call select_environment again with environment_session null and host set to exactly what the user " +
  "typed.";

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
