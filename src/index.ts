#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createCartesMcpServer } from "./mcp-server.js";

const server = createCartesMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);
