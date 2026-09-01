import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { CartesHostClient } from "../src/host-client.js";
import { startCartesHost } from "../src/host-server.js";
import { createCartesMcpServer } from "../src/mcp-server.js";
import { MultiplayerTableStore, type PublicTableView } from "../src/multiplayer-store.js";

const THREE_SEAT_DECK = ["♠5", "♥6", "♦7", "♣9", "♦6", "♣5", "♠4", "♥8", "♠2", "♥3"];

test("multiple MCP Agents share turns and receive independent notifications without private state", async (context) => {
  const store = new MultiplayerTableStore(() => THREE_SEAT_DECK);
  const host = await startCartesHost({ port: 0, store });
  const first = await connectMcp(new CartesHostClient(host.url), "agent-a", context);
  const second = await connectMcp(new CartesHostClient(host.url), "agent-b", context);
  const replacement = await connectMcp(new CartesHostClient(host.url), "agent-a-reconnected", context);
  context.after(() => host.close());

  const tools = await first.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ["get_table_view", "join_table", "leave_table", "say_at_table", "take_action", "wait_for_table_event"],
  );
  assert.equal(JSON.stringify(tools).includes("start_new_round"), false);
  for (const tool of tools.tools) {
    assert.equal(JSON.stringify(tool.inputSchema).includes('"deck"'), false);
    assert.equal(JSON.stringify(tool.inputSchema).includes('"seed"'), false);
  }

  const beforeJoin = await first.callTool({ name: "get_table_view", arguments: {} });
  assert.equal(beforeJoin.isError, true);

  const created = store.createTable("blackjack", "阿童");
  const firstJoin = await first.callTool({
    name: "join_table",
    arguments: { join_code: created.table.join_code, agent_name: "小葵" },
  });
  const secondJoin = await second.callTool({
    name: "join_table",
    arguments: { join_code: created.table.join_code, agent_name: "阿宇" },
  });
  assert.equal(firstJoin.isError, undefined);
  assert.equal(secondJoin.isError, undefined);
  assert.equal(JSON.stringify(firstJoin).includes("agent_token"), false, "capability tokens stay inside each MCP process");

  const joinedView = tableFrom(secondJoin);
  const opened = store.startRound(created.human_token, joinedView.version, "human-start-mcp-01");
  assertPrivateStateAbsent(opened, ["♥8", "♠2"]);

  await first.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 0 } });
  await second.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 0 } });
  const humanStand = store.humanAction(created.human_token, "stand", opened.version, "human-stand-mcp-1");

  const firstNotice = await first.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 0 } });
  assert.equal(firstNotice.isError, undefined);
  const firstTurn = eventTableFrom(firstNotice);
  assert.equal(firstTurn.active_seat_id, firstTurn.viewer_seat_id);
  assert.deepEqual(firstTurn.legal_actions, ["hit", "stand"]);
  assert.equal(eventKinds(firstNotice).includes("player_stood"), true);
  assertPrivateStateAbsent(firstNotice, ["♥8", "♠2"]);

  const reconnectTicket = store.createAgentReconnectTicket(created.human_token, firstTurn.viewer_seat_id);
  const rejoined = await replacement.callTool({
    name: "join_table",
    arguments: {
      join_code: created.table.join_code,
      agent_name: "小葵",
      reconnect_code: reconnectTicket.reconnect_code,
    },
  });
  assert.deepEqual(tableFrom(rejoined).legal_actions, ["hit", "stand"]);
  assert.equal(JSON.stringify(rejoined).includes(reconnectTicket.reconnect_code), false);
  assert.equal(
    (await first.callTool({ name: "get_table_view", arguments: {} })).isError,
    true,
    "the displaced MCP process loses its old seat token",
  );
  const freshTable = store.createTable("tenhalf", "另一位人類");
  const movedToFreshTable = await first.callTool({
    name: "join_table",
    arguments: { join_code: freshTable.table.join_code, agent_name: "小葵換桌" },
  });
  assert.equal(movedToFreshTable.isError, undefined, "a stale process-local token does not block joining a new table");
  assert.equal(tableFrom(movedToFreshTable).join_code, freshTable.table.join_code);

  const earlySecond = await second.callTool({
    name: "take_action",
    arguments: { action: "stand", expected_version: humanStand.version, idempotency_key: "agent-b-early-mcp" },
  });
  assert.equal(earlySecond.isError, true);
  assertPrivateStateAbsent(earlySecond, ["♥8", "♠2"]);

  const firstStand = await replacement.callTool({
    name: "take_action",
    arguments: { action: "stand", expected_version: firstTurn.version, idempotency_key: "agent-a-stand-mcp" },
  });
  assert.equal(firstStand.isError, undefined);

  const secondNotice = await second.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 0 } });
  const secondTurn = eventTableFrom(secondNotice);
  assert.equal(secondTurn.active_seat_id, secondTurn.viewer_seat_id);
  assert.equal(eventKinds(secondNotice).includes("player_stood"), true);
  assert.equal(eventKinds(secondNotice).includes("turn_started"), true);

  const secondStand = await second.callTool({
    name: "take_action",
    arguments: { action: "stand", expected_version: secondTurn.version, idempotency_key: "agent-b-stand-mcp" },
  });
  const ended = tableFrom(secondStand);
  assert.equal(ended.phase, "ended");
  assert.deepEqual(ended.dealer.cards, ["♣9", "♥8"]);

  await replacement.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 0 } });
  await second.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 0 } });
  const waitingForChat = second.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 2 } });
  await replacement.callTool({
    name: "say_at_table",
    arguments: { message: "下一局再來。", idempotency_key: "agent-a-chat-mcp1" },
  });
  const chatNotice = await waitingForChat;
  assert.equal(eventKinds(chatNotice).includes("message"), true);
  assert.equal(eventTableFrom(chatNotice).recent_chat.at(-1)?.speaker, "小葵");

  const departure = await replacement.callTool({ name: "leave_table", arguments: {} });
  assert.equal(departure.isError, undefined);
  assert.equal(
    (departure.structuredContent as { departure?: { left?: boolean } }).departure?.left,
    true,
  );
  const repeatedDeparture = await replacement.callTool({ name: "leave_table", arguments: {} });
  assert.deepEqual(repeatedDeparture.structuredContent, departure.structuredContent);
  assert.equal((await replacement.callTool({ name: "get_table_view", arguments: {} })).isError, true);
  const afterLeaving = store.createTable("blackjack", "第三位人類");
  const joinedAfterLeaving = await replacement.callTool({
    name: "join_table",
    arguments: { join_code: afterLeaving.table.join_code, agent_name: "小葵新桌" },
  });
  assert.equal(joinedAfterLeaving.isError, undefined, "leave_table releases the process-local seat token");
});

async function connectMcp(host: CartesHostClient, name: string, context: TestContext): Promise<Client> {
  const server = createCartesMcpServer(host);
  const client = new Client({ name, version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  context.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function tableFrom(result: unknown): PublicTableView {
  const table = (result as { structuredContent?: { table?: PublicTableView } }).structuredContent?.table;
  assert.ok(table);
  return table;
}

function eventTableFrom(result: unknown): PublicTableView {
  const table = (result as { structuredContent?: { table?: PublicTableView } }).structuredContent?.table;
  assert.ok(table);
  return table;
}

function eventKinds(result: unknown): string[] {
  return ((result as { structuredContent?: { events?: Array<{ kind: string }> } }).structuredContent?.events ?? []).map(
    (event) => event.kind,
  );
}

function assertPrivateStateAbsent(value: unknown, forbiddenCards: string[]): void {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes('"deck"'), false);
  for (const card of forbiddenCards) assert.equal(serialized.includes(card), false, `leaked private card ${card}`);
}
