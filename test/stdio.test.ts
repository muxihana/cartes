import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("compiled STDIO entrypoint completes the MCP handshake", async (context) => {
  const serverPath = fileURLToPath(new URL("../src/index.js", import.meta.url));
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] });
  const client = new Client({ name: "cartes-stdio-test", version: "1.0.0" });
  context.after(async () => client.close());
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.some((tool) => tool.name === "join_table"), true);
  assert.equal(tools.tools.some((tool) => tool.name === "list_tables"), false);
});
