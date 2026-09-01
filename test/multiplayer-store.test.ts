import assert from "node:assert/strict";
import test from "node:test";

import { MultiplayerTableStore } from "../src/multiplayer-store.js";

const THREE_SEAT_DECK = [
  "♠5",
  "♥6",
  "♦7",
  "♣9",
  "♦6",
  "♣5",
  "♠4",
  "♥8",
  "♠2",
  "♥3",
  "♦2",
  "♣2",
];

test("one human and multiple agents take independent turns against one dealer", () => {
  const store = new MultiplayerTableStore(() => THREE_SEAT_DECK);
  const created = store.createTable("blackjack", "阿童");
  const first = store.joinAgent(created.table.join_code, "小葵");
  const second = store.joinAgent(created.table.join_code, "阿宇");

  const opened = store.startRound(created.human_token, second.table.version, "human-start-0001");
  assert.equal(opened.phase, "player_turns");
  assert.equal(opened.active_seat_id, opened.viewer_seat_id);
  assert.deepEqual(opened.legal_actions, ["hit", "stand"]);
  assert.deepEqual(opened.dealer.cards, ["♣9"]);
  assertPrivateStateAbsent(opened, ["♥8", "♠2"]);

  const humanHit = store.humanAction(created.human_token, "hit", opened.version, "human-hit-00001");
  assert.deepEqual(humanHit.players[0]!.cards, ["♠5", "♦6", "♠2"]);
  assert.equal(humanHit.active_seat_id, humanHit.viewer_seat_id);

  const humanStand = store.humanAction(created.human_token, "stand", humanHit.version, "human-stand-001");
  assert.equal(humanStand.players[1]!.name, "小葵");
  assert.equal(humanStand.active_seat_id, humanStand.players[1]!.seat_id);
  assert.throws(
    () => store.agentAction(second.agent_token, "hit", humanStand.version, "agent-b-early-01"),
    /不是你的回合/,
  );

  const firstStand = store.agentAction(first.agent_token, "stand", humanStand.version, "agent-a-stand-01");
  assert.equal(firstStand.active_seat_id, firstStand.players[2]!.seat_id);
  const ended = store.agentAction(second.agent_token, "stand", firstStand.version, "agent-b-stand-01");

  assert.equal(ended.phase, "ended");
  assert.equal(ended.active_seat_id, null);
  assert.deepEqual(ended.dealer.cards, ["♣9", "♥8"]);
  assert.equal(ended.dealer.points, 17);
  assert.equal(ended.players.every((seat) => seat.result !== null), true);
});

test("every agent has an independent event cursor and is notified of other seats", async () => {
  const store = new MultiplayerTableStore(() => THREE_SEAT_DECK);
  const created = store.createTable("blackjack", "阿童");
  const first = store.joinAgent(created.table.join_code, "小葵");
  const second = store.joinAgent(created.table.join_code, "阿宇");

  store.startRound(created.human_token, second.table.version, "human-start-0002");
  const firstOpening = await store.waitForAgentEvents(first.agent_token, 0);
  const secondOpening = await store.waitForAgentEvents(second.agent_token, 0);
  assert.equal(firstOpening.events.some((event) => event.kind === "seat_joined" && event.actor_name === "阿宇"), true);
  assert.equal(secondOpening.events.some((event) => event.kind === "turn_started" && event.actor_name === "阿童"), true);

  const firstWaiting = store.waitForAgentEvents(first.agent_token, 2_000);
  const secondWaiting = store.waitForAgentEvents(second.agent_token, 2_000);
  const humanView = store.getHumanView(created.human_token);
  store.humanAction(created.human_token, "stand", humanView.version, "human-stand-002");

  const [firstNotice, secondNotice] = await Promise.all([firstWaiting, secondWaiting]);
  for (const notice of [firstNotice, secondNotice]) {
    assert.equal(notice.timed_out, false);
    assert.equal(notice.events.some((event) => event.kind === "player_stood" && event.actor_name === "阿童"), true);
  }
  assert.equal(firstNotice.events.some((event) => event.actor_seat_id === first.table.viewer_seat_id), false);
  assert.equal(secondNotice.events.some((event) => event.kind === "turn_started" && event.actor_name === "小葵"), true);

  await store.waitForAgentEvents(first.agent_token, 0);
  await store.waitForAgentEvents(second.agent_token, 0);
  const messageWaiting = store.waitForAgentEvents(second.agent_token, 2_000);
  store.agentSay(first.agent_token, "輪到我了。", "agent-a-chat-001");
  const ownMessage = await store.waitForAgentEvents(first.agent_token, 0);
  const messageNotice = await messageWaiting;
  assert.equal(ownMessage.timed_out, true, "an Agent does not wake itself with its own chat");
  assert.deepEqual(ownMessage.events, []);
  assert.equal(messageNotice.events.some((event) => event.kind === "message" && event.actor_name === "小葵"), true);
  assert.equal(messageNotice.table.recent_chat.at(-1)?.text, "輪到我了。");
});

test("game writes are idempotent and chat does not invalidate an active turn", () => {
  const store = new MultiplayerTableStore(() => THREE_SEAT_DECK);
  const created = store.createTable("blackjack", "阿童");
  const agent = store.joinAgent(created.table.join_code, "小葵");
  const opened = store.startRound(created.human_token, agent.table.version, "human-start-0003");
  const beforeChatVersion = opened.version;
  const chatted = store.agentSay(agent.agent_token, "慢慢想。", "agent-chat-0001");
  assert.equal(chatted.version, beforeChatVersion);

  const hit = store.humanAction(created.human_token, "hit", beforeChatVersion, "human-hit-00003");
  const replay = store.humanAction(created.human_token, "hit", beforeChatVersion, "human-hit-00003");
  assert.deepEqual(replay, hit);
  assert.equal(hit.players[0]!.cards.length, 3);
});

function assertPrivateStateAbsent(value: unknown, forbiddenCards: string[]): void {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes('"deck"'), false);
  for (const card of forbiddenCards) assert.equal(serialized.includes(card), false, `leaked private card ${card}`);
}
