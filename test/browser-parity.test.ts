import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { JSDOM, VirtualConsole } from "jsdom";

import { applyAction, createDeck, startGame, visibleDealerCards, type GameAction, type GameMode, type GameState } from "../src/game.js";

interface BrowserSnapshot {
  mode: GameMode;
  phase: "you" | "dealer" | "ended";
  youCards: string[];
  dealerCards: string[];
  visibleDealerCards: string[];
  holeRevealed: boolean;
  deck: string[];
  result: { outcome: "you" | "dealer" | "push"; special: string } | null;
}

interface BrowserTestApi {
  setDeck(sequence: string[], mode: GameMode): BrowserSnapshot;
  state(): BrowserSnapshot;
  hit(): unknown;
  stand(): unknown;
}

interface ParityCase {
  name: string;
  mode: GameMode;
  prefix: string[];
  actions: GameAction[];
}

const CASES: ParityCase[] = [
  { name: "blackjack: opening player blackjack", mode: "blackjack", prefix: ["♠A", "♥9", "♦K", "♣8"], actions: [] },
  { name: "blackjack: dealer blackjack", mode: "blackjack", prefix: ["♠10", "♥A", "♦8", "♣K"], actions: ["stand"] },
  { name: "blackjack: player busts on hit", mode: "blackjack", prefix: ["♠10", "♥9", "♦6", "♣7", "♠8"], actions: ["hit"] },
  { name: "blackjack: dealer busts", mode: "blackjack", prefix: ["♠10", "♥9", "♦7", "♣6", "♠8"], actions: ["stand"] },
  { name: "blackjack: dealer draws to hard 17", mode: "blackjack", prefix: ["♠10", "♥6", "♦7", "♣5", "♠6"], actions: ["stand"] },
  { name: "blackjack: dealer stands on soft 17", mode: "blackjack", prefix: ["♠A", "♥A", "♦6", "♣6", "♠10"], actions: ["stand"] },
  { name: "blackjack: equal points push", mode: "blackjack", prefix: ["♠10", "♥10", "♦7", "♣7"], actions: ["stand"] },
  { name: "blackjack: hit to 21 then stand", mode: "blackjack", prefix: ["♠5", "♥9", "♦6", "♣7", "♠10", "♥5"], actions: ["hit", "stand"] },
  { name: "blackjack: three hits then stand", mode: "blackjack", prefix: ["♠2", "♥10", "♦3", "♣7", "♠4", "♥5", "♦6"], actions: ["hit", "hit", "hit", "stand"] },
  { name: "blackjack: two aces become hard", mode: "blackjack", prefix: ["♠A", "♥9", "♦A", "♣7", "♠9", "♥2"], actions: ["hit", "stand"] },
  { name: "blackjack: ace hand eventually busts", mode: "blackjack", prefix: ["♠A", "♥10", "♦9", "♣7", "♠K", "♥5"], actions: ["hit", "hit"] },
  { name: "blackjack: dealer takes three cards", mode: "blackjack", prefix: ["♠10", "♥2", "♦8", "♣3", "♠4", "♥5", "♦6"], actions: ["stand"] },
  { name: "tenhalf: player wins at ten", mode: "tenhalf", prefix: ["♠10", "♥9"], actions: ["stand"] },
  { name: "tenhalf: dealer draws to eight", mode: "tenhalf", prefix: ["♠9", "♥7", "♦A"], actions: ["stand"] },
  { name: "tenhalf: dealer stands at eight", mode: "tenhalf", prefix: ["♠9", "♥8"], actions: ["stand"] },
  { name: "tenhalf: player busts", mode: "tenhalf", prefix: ["♠8", "♥9", "♦3"], actions: ["hit"] },
  { name: "tenhalf: exact ten-and-a-half", mode: "tenhalf", prefix: ["♠10", "♥8", "♦J"], actions: ["hit"] },
  { name: "tenhalf: five dragon", mode: "tenhalf", prefix: ["♠2", "♥8", "♦A", "♣A", "♠3", "♥2"], actions: ["hit", "hit", "hit", "hit"] },
  { name: "tenhalf: face cards count half", mode: "tenhalf", prefix: ["♠J", "♥7", "♦Q", "♣K", "♠A"], actions: ["hit", "hit", "stand"] },
  { name: "tenhalf: dealer busts", mode: "tenhalf", prefix: ["♠9", "♥7", "♦4"], actions: ["stand"] },
  { name: "tenhalf: dealer reaches ten-and-a-half", mode: "tenhalf", prefix: ["♠10", "♥7", "♦J", "♣3"], actions: ["stand"] },
  { name: "tenhalf: equal points push", mode: "tenhalf", prefix: ["♠8", "♥7", "♦A"], actions: ["stand"] },
  { name: "tenhalf: three face-card hits reach ten-and-a-half", mode: "tenhalf", prefix: ["♠9", "♥8", "♦J", "♣Q", "♠K"], actions: ["hit", "hit", "hit"] },
  { name: "tenhalf: low five dragon beats points", mode: "tenhalf", prefix: ["♠A", "♥7", "♦2", "♣2", "♠3", "♥A", "♦J", "♣3"], actions: ["hit", "hit", "hit", "hit"] },
];

test("MCP game core stays step-for-step compatible with the original browser rules", async (context) => {
  const htmlPath = fileURLToPath(new URL("../../index.html", import.meta.url));
  const browserErrors: Error[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => browserErrors.push(error));
  const dom = new JSDOM(readFileSync(htmlPath, "utf8"), {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://cartes.test/",
    virtualConsole,
  });
  context.after(() => dom.window.close());
  const browser = (dom.window as unknown as { cardsTest: BrowserTestApi }).cardsTest;
  assert.ok(browser, "the original browser test hook must be available");

  for (const vector of CASES) {
    const deck = completeDeck(vector.prefix);
    let browserState = browser.setDeck(deck, vector.mode);
    const coreState = startGame(vector.mode, deck);
    assertParity(vector.name, "opening deal", browserState, coreState);

    for (const [index, action] of vector.actions.entries()) {
      if (action === "hit") browser.hit();
      else browser.stand();
      applyAction(coreState, action);
      browserState = browser.state();
      assertParity(vector.name, `action ${index + 1}: ${action}`, browserState, coreState);
    }
  }
  assert.deepEqual(browserErrors, [], "the original browser app must not emit jsdom runtime errors");
});

function completeDeck(prefix: string[]): string[] {
  assert.equal(new Set(prefix).size, prefix.length, `fixed deck prefix contains a duplicate: ${prefix.join(" ")}`);
  return prefix.concat(createDeck().map((card) => card.code).filter((card) => !prefix.includes(card)));
}

function assertParity(label: string, step: string, browser: BrowserSnapshot, core: GameState): void {
  const normalizeResult = browser.result
    ? {
        outcome: browser.result.outcome === "you" ? "player" : browser.result.outcome,
        special: ({ youbust: "player_bust", dealerbust: "dealer_bust" } as Record<string, string>)[browser.result.special] ?? browser.result.special,
      }
    : null;
  assert.deepEqual(
    {
      mode: browser.mode,
      phase: browser.phase === "you" ? "player_turn" : browser.phase,
      playerCards: Array.from(browser.youCards),
      dealerCards: Array.from(browser.dealerCards),
      visibleDealerCards: Array.from(browser.visibleDealerCards),
      holeRevealed: browser.holeRevealed,
      deck: Array.from(browser.deck),
      result: normalizeResult,
    },
    {
      mode: core.mode,
      phase: core.phase,
      playerCards: core.playerCards.map((card) => card.code),
      dealerCards: core.dealerCards.map((card) => card.code),
      visibleDealerCards: visibleDealerCards(core).map((card) => card.code),
      holeRevealed: core.holeRevealed,
      deck: core.deck.map((card) => card.code),
      result: core.result ? { outcome: core.result.outcome, special: core.result.special } : null,
    },
    `${label} diverged after ${step}`,
  );
}
