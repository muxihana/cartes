import assert from "node:assert/strict";
import test from "node:test";

import { applyAction, scoreHand, startGame, visibleDealerCards } from "../src/game.js";

test("blackjack scores soft and hard aces", () => {
  assert.deepEqual(scoreHand("blackjack", ["♠A", "♥6"]), { total: 17, soft: true, bust: false });
  assert.deepEqual(scoreHand("blackjack", ["♠A", "♥6", "♦10"]), { total: 17, soft: false, bust: false });
});

test("ten-and-a-half gives face cards half a point", () => {
  assert.equal(scoreHand("tenhalf", ["♣J", "♦Q"]).total, 1);
});

test("dealer hole card and deck remain private during the player turn", () => {
  const game = startGame("blackjack", ["♠10", "♥9", "♦7", "♣8", "♠2"]);
  assert.deepEqual(game.playerCards.map((card) => card.code), ["♠10", "♦7"]);
  assert.deepEqual(visibleDealerCards(game).map((card) => card.code), ["♥9"]);
  assert.equal(game.holeRevealed, false);
});

test("standing runs the dealer and settles the round", () => {
  const game = startGame("blackjack", ["♠10", "♥9", "♦7", "♣7", "♠5"]);
  const result = applyAction(game, "stand");
  assert.equal(game.phase, "ended");
  assert.equal(game.holeRevealed, true);
  assert.equal(result?.outcome, "dealer");
  assert.deepEqual(game.dealerCards.map((card) => card.code), ["♥9", "♣7", "♠5"]);
});

test("an opening blackjack settles immediately", () => {
  const game = startGame("blackjack", ["♠A", "♥9", "♦K", "♣8"]);
  assert.equal(game.phase, "ended");
  assert.equal(game.result?.outcome, "player");
  assert.equal(game.result?.special, "blackjack");
});
