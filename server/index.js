#!/usr/bin/env node
// Entry point: Claude Desktop starts this over stdio (see manifest.json).

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

await createServer().connect(new StdioServerTransport());
