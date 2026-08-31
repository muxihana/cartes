import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createCartesMcpServer } from "../src/mcp-server.js";
import { TableStore } from "../src/table-store.js";

test("MCP exposes player-safe tools and never returns hidden state", async (context) => {
  const store = new TableStore(() => ["♠10", "♥9", "♦7", "♣8", "♠2"]);
  const server = createCartesMcpServer(store);
  const client = new Client({ name: "cartes-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  context.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ["get_table_view", "join_table", "say_at_table", "start_new_round", "take_action"],
  );

  const joined = await client.callTool({
    name: "join_table",
    arguments: { mode: "blackjack", player_name: "測試 AI" },
  });
  assert.equal(joined.isError, undefined);
  const serialized = JSON.stringify(joined);
  assert.equal(serialized.includes("♣8"), false, "MCP response must hide the dealer hole card");
  assert.equal(serialized.includes("♠2"), false, "MCP response must hide the remaining deck");
  assert.equal(serialized.includes('"deck"'), false, "MCP response must not expose a deck field");
});
