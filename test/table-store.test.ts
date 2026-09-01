import assert from "node:assert/strict";
import test from "node:test";

import { TableStore } from "../src/table-store.js";

test("table views expose legal actions but not the deck or hidden card", () => {
  const store = new TableStore(() => ["♠10", "♥9", "♦7", "♣8", "♠2"]);
  const view = store.joinTable("blackjack", "測試玩家");
  assert.deepEqual(view.dealer_cards, ["♥9"]);
  assert.deepEqual(view.legal_actions, ["hit", "stand"]);
  assert.equal("deck" in view, false);
  assert.equal(view.version, 1);
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("♣8"), false, "dealer hole card must not be serialized");
  assert.equal(serialized.includes("♠2"), false, "remaining deck must not be serialized");
});

test("writes reject stale versions", () => {
  const store = new TableStore(() => ["♠10", "♥9", "♦7", "♣8", "♠2"]);
  const view = store.joinTable("blackjack", "測試玩家");
  const next = store.sayAtTable(view.table_id, "先看一下。", view.version, "message-0001");
  assert.equal(next.version, 2);
  assert.throws(
    () => store.takeAction(view.table_id, "hit", view.version, "action-0001"),
    /牌桌版本衝突/,
  );
});

test("idempotency keys replay the original result without drawing twice", () => {
  const store = new TableStore(() => ["♠5", "♥9", "♦6", "♣8", "♠2", "♥3"]);
  const view = store.joinTable("blackjack", "測試玩家");
  const first = store.takeAction(view.table_id, "hit", view.version, "action-0002");
  const replay = store.takeAction(view.table_id, "hit", view.version, "action-0002");
  assert.deepEqual(replay, first);
  assert.deepEqual(first.player_cards, ["♠5", "♦6", "♠2"]);
  assert.equal(first.version, 2);
});

test("a completed round can start a new round and keeps records", () => {
  const decks = [
    ["♠10", "♥9", "♦7", "♣7", "♠5"],
    ["♠A", "♥5", "♦K", "♣6"],
  ];
  const store = new TableStore((_mode, round) => decks[round - 1]!);
  const opened = store.joinTable("blackjack", "測試玩家");
  const ended = store.takeAction(opened.table_id, "stand", opened.version, "action-0003");
  assert.equal(ended.phase, "ended");
  assert.equal(ended.records.dealer, 1);
  const next = store.startNewRound(ended.table_id, ended.version, "round-0002");
  assert.equal(next.round, 2);
  assert.equal(next.records.dealer, 1);
  assert.equal(next.records.player, 1);
});
