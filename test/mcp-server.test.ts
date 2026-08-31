import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createCartesMcpServer } from "../src/mcp-server.js";
import { TableStore, type TableView } from "../src/table-store.js";

test("every MCP tool, error, and retry path preserves double-blind state", async (context) => {
  const decks = [
    ["♠5", "♥9", "♦6", "♣8", "♠2", "♥3", "♦4"],
    ["♠4", "♥7", "♦5", "♣6", "♠A", "♥2", "♦3"],
  ];
  const store = new TableStore((_mode, round) => decks[round - 1]!);
  const server = createCartesMcpServer(store);
  const client = new Client({ name: "cartes-red-team", version: "1.0.0" });
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
  assert.equal(JSON.stringify(tools).includes("list_tables"), false);
  for (const tool of tools.tools) {
    assert.equal(JSON.stringify(tool.inputSchema).includes('"deck"'), false, `${tool.name} must not accept a deck`);
    assert.equal(JSON.stringify(tool.inputSchema).includes('"seed"'), false, `${tool.name} must not accept a shuffle seed`);
  }

  const joined = await client.callTool({
    name: "join_table",
    arguments: { mode: "blackjack", player_name: "測試 AI" },
  });
  assert.equal(joined.isError, undefined);
  assertPrivateStateAbsent(joined, ["♣8", "♠2", "♥3"]);
  const opening = tableFrom(joined);

  const read = await client.callTool({ name: "get_table_view", arguments: { table_id: opening.table_id } });
  assert.equal(read.isError, undefined);
  assertPrivateStateAbsent(read, ["♣8", "♠2", "♥3"]);
  assert.deepEqual(tableFrom(read), opening);

  const said = await client.callTool({
    name: "say_at_table",
    arguments: {
      table_id: opening.table_id,
      message: "我先看牌。",
      expected_version: opening.version,
      idempotency_key: "chat-red-team-0001",
    },
  });
  assert.equal(said.isError, undefined);
  assertPrivateStateAbsent(said, ["♣8", "♠2", "♥3"]);
  const afterChat = tableFrom(said);
  assert.equal(afterChat.recent_chat.length, 1);

  const chatReplay = await client.callTool({
    name: "say_at_table",
    arguments: {
      table_id: opening.table_id,
      message: "我先看牌。",
      expected_version: opening.version,
      idempotency_key: "chat-red-team-0001",
    },
  });
  assert.equal(chatReplay.isError, undefined);
  assertPrivateStateAbsent(chatReplay, ["♣8", "♠2", "♥3"]);
  assert.deepEqual(tableFrom(chatReplay), afterChat, "chat retry must not append twice");

  const keyReuse = await client.callTool({
    name: "take_action",
    arguments: {
      table_id: opening.table_id,
      action: "hit",
      expected_version: afterChat.version,
      idempotency_key: "chat-red-team-0001",
    },
  });
  assert.equal(keyReuse.isError, true);
  assertPrivateStateAbsent(keyReuse, ["♣8", "♠2", "♥3"]);

  const staleWrite = await client.callTool({
    name: "take_action",
    arguments: {
      table_id: opening.table_id,
      action: "hit",
      expected_version: opening.version,
      idempotency_key: "stale-red-team-001",
    },
  });
  assert.equal(staleWrite.isError, true);
  assertPrivateStateAbsent(staleWrite, ["♣8", "♠2", "♥3"]);

  const hit = await client.callTool({
    name: "take_action",
    arguments: {
      table_id: opening.table_id,
      action: "hit",
      expected_version: afterChat.version,
      idempotency_key: "action-red-team-01",
    },
  });
  assert.equal(hit.isError, undefined);
  assertPrivateStateAbsent(hit, ["♣8", "♥3"]);
  const afterHit = tableFrom(hit);
  assert.deepEqual(afterHit.player_cards, ["♠5", "♦6", "♠2"]);

  const hitReplay = await client.callTool({
    name: "take_action",
    arguments: {
      table_id: opening.table_id,
      action: "hit",
      expected_version: afterChat.version,
      idempotency_key: "action-red-team-01",
    },
  });
  assert.equal(hitReplay.isError, undefined);
  assertPrivateStateAbsent(hitReplay, ["♣8", "♥3"]);
  assert.deepEqual(tableFrom(hitReplay), afterHit, "action retry must not draw twice");

  const stand = await client.callTool({
    name: "take_action",
    arguments: {
      table_id: opening.table_id,
      action: "stand",
      expected_version: afterHit.version,
      idempotency_key: "action-red-team-02",
    },
  });
  assert.equal(stand.isError, undefined);
  assertPrivateStateAbsent(stand, ["♥3", "♦4"]);
  const ended = tableFrom(stand);
  assert.equal(ended.phase, "ended");
  assert.deepEqual(ended.dealer_cards, ["♥9", "♣8"], "hole card becomes public only after settlement");

  const nextRound = await client.callTool({
    name: "start_new_round",
    arguments: {
      table_id: opening.table_id,
      expected_version: ended.version,
      idempotency_key: "round-red-team-001",
    },
  });
  assert.equal(nextRound.isError, undefined);
  assertPrivateStateAbsent(nextRound, ["♣6", "♠A", "♥2"]);
  const roundTwo = tableFrom(nextRound);
  assert.equal(roundTwo.round, 2);

  const roundReplay = await client.callTool({
    name: "start_new_round",
    arguments: {
      table_id: opening.table_id,
      expected_version: ended.version,
      idempotency_key: "round-red-team-001",
    },
  });
  assert.equal(roundReplay.isError, undefined);
  assertPrivateStateAbsent(roundReplay, ["♣6", "♠A", "♥2"]);
  assert.deepEqual(tableFrom(roundReplay), roundTwo, "new-round retry must not deal twice");

  const prematureRound = await client.callTool({
    name: "start_new_round",
    arguments: {
      table_id: opening.table_id,
      expected_version: roundTwo.version,
      idempotency_key: "round-red-team-002",
    },
  });
  assert.equal(prematureRound.isError, true);
  assertPrivateStateAbsent(prematureRound, ["♣6", "♠A", "♥2"]);

  const blankChat = await client.callTool({
    name: "say_at_table",
    arguments: {
      table_id: opening.table_id,
      message: "   ",
      expected_version: roundTwo.version,
      idempotency_key: "chat-red-team-0002",
    },
  });
  assert.equal(blankChat.isError, true);
  assertPrivateStateAbsent(blankChat, ["♣6", "♠A", "♥2"]);

  const missingTable = await client.callTool({
    name: "get_table_view",
    arguments: { table_id: randomUUID() },
  });
  assert.equal(missingTable.isError, true);
  assertPrivateStateAbsent(missingTable, ["♣6", "♠A", "♥2"]);
});

function tableFrom(result: unknown): TableView {
  const structured = (result as { structuredContent?: { table?: unknown } }).structuredContent;
  assert.ok(structured?.table, "successful tool result must have a structured table view");
  return structured.table as TableView;
}

function assertPrivateStateAbsent(result: unknown, forbiddenCards: string[]): void {
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('"deck"'), false, "tool result must not expose a deck field");
  for (const card of forbiddenCards) {
    assert.equal(serialized.includes(card), false, `tool result leaked private card ${card}`);
  }
}
