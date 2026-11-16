// Writes the tool names and descriptions of server/tools.js into manifest.json, so the
// extension listing in Claude Desktop shows them. test/manifest.test.js checks they match.

import { readFileSync, writeFileSync } from "node:fs";
import { toolList } from "../server/tools.js";

const path = new URL("../manifest.json", import.meta.url);
const manifest = JSON.parse(readFileSync(path, "utf8"));
manifest.tools = toolList().map(({ name, description }) => ({ name, description }));
writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
