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

test("separate STDIO clients cannot discover or read each other's in-memory tables", async (context) => {
  const serverPath = fileURLToPath(new URL("../src/index.js", import.meta.url));
  const firstTransport = new StdioClientTransport({ command: process.execPath, args: [serverPath] });
  const secondTransport = new StdioClientTransport({ command: process.execPath, args: [serverPath] });
  const first = new Client({ name: "cartes-isolation-a", version: "1.0.0" });
  const second = new Client({ name: "cartes-isolation-b", version: "1.0.0" });
  context.after(async () => {
    await first.close();
    await second.close();
  });
  await Promise.all([first.connect(firstTransport), second.connect(secondTransport)]);

  const joined = await first.callTool({
    name: "join_table",
    arguments: { mode: "blackjack", player_name: "client A" },
  });
  const tableId = (joined.structuredContent as { table: { table_id: string } }).table.table_id;
  const crossRead = await second.callTool({ name: "get_table_view", arguments: { table_id: tableId } });

  assert.equal(crossRead.isError, true);
  assert.equal(JSON.stringify(crossRead).includes(tableId), false, "missing-table errors must not echo table identifiers");
  assert.equal(JSON.stringify(crossRead).includes('"deck"'), false);
});
