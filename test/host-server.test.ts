import assert from "node:assert/strict";
import test from "node:test";

import { CartesHostClient } from "../src/host-client.js";
import { startCartesHost } from "../src/host-server.js";
import { MultiplayerTableStore, type HumanTableResult, type PublicTableView } from "../src/multiplayer-store.js";

const TWO_SEAT_DECK = ["♠5", "♥6", "♦9", "♣6", "♠4", "♥8", "♦2", "♣3"];

test("HTTP host serves the human UI and shares one authority with Agent clients", async (context) => {
  const store = new MultiplayerTableStore(() => TWO_SEAT_DECK);
  const host = await startCartesHost({ port: 0, store });
  context.after(() => host.close());

  const page = await fetch(host.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Cartes 共桌牌局/);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);

  const created = await request<HumanTableResult>(host.url, "/api/tables", {
    method: "POST",
    body: { mode: "blackjack", human_name: "阿童" },
  });
  const agent = new CartesHostClient(host.url);
  const joined = await agent.joinAgent(created.table.join_code, "小葵");
  assert.equal(joined.table.players.length, 2);

  const opened = await request<{ table: PublicTableView }>(host.url, "/api/human/start-round", {
    method: "POST",
    token: created.human_token,
    body: { expected_version: joined.table.version, idempotency_key: "human-start-http-01" },
  });
  assert.deepEqual(opened.table.dealer.cards, ["♦9"]);
  assertPrivateStateAbsent(opened, ["♥8", "♦2"]);

  await agent.waitForEvents(joined.agent_token, 0);
  const waiting = agent.waitForEvents(joined.agent_token, 2_000);
  await request(host.url, "/api/human/action", {
    method: "POST",
    token: created.human_token,
    body: { action: "stand", expected_version: opened.table.version, idempotency_key: "human-stand-http-1" },
  });
  const notice = await waiting;
  assert.equal(notice.timed_out, false);
  assert.equal(notice.events.some((event) => event.kind === "player_stood" && event.actor_name === "阿童"), true);
  assert.equal(notice.table.legal_actions.includes("hit"), true, "the waiting Agent becomes active");

  const unauthorized = await fetch(`${host.url}/api/human/table`, { headers: { Authorization: "Bearer wrong" } });
  assert.equal(unauthorized.status, 401);
  assert.equal(JSON.stringify(await unauthorized.json()).includes('"deck"'), false);
});

async function request<T = unknown>(
  baseUrl: string,
  path: string,
  options: { method: "GET" | "POST"; token?: string; body?: Record<string, unknown> },
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  return payload as T;
}

function assertPrivateStateAbsent(value: unknown, forbiddenCards: string[]): void {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes('"deck"'), false);
  for (const card of forbiddenCards) assert.equal(serialized.includes(card), false, `leaked private card ${card}`);
}
