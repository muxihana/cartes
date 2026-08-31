import { randomInt } from "node:crypto";

export type GameMode = "blackjack" | "tenhalf";
export type GamePhase = "player_turn" | "ended";
export type GameAction = "hit" | "stand";
export type Outcome = "player" | "dealer" | "push";

export interface Card {
  readonly suit: "♠" | "♥" | "♦" | "♣";
  readonly rank: "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
  readonly code: string;
}

export interface HandScore {
  readonly total: number;
  readonly soft: boolean;
  readonly bust: boolean;
}

export interface ClassifiedHand {
  readonly kind: "bust" | "blackjack" | "tenhalf" | "fivedragon" | "points";
  readonly rank: number;
  readonly score: HandScore;
}

export interface GameResult {
  readonly outcome: Outcome;
  readonly special: "" | "player_bust" | "dealer_bust" | "blackjack" | "tenhalf" | "fivedragon";
  readonly player: ClassifiedHand;
  readonly dealer: ClassifiedHand;
}

export interface GameState {
  mode: GameMode;
  phase: GamePhase;
  deck: Card[];
  playerCards: Card[];
  dealerCards: Card[];
  holeRevealed: boolean;
  result: GameResult | null;
}

export const RULES = Object.freeze({
  blackjack: Object.freeze({ label: "21 點", dealerStand: 17, openingCards: 2 }),
  tenhalf: Object.freeze({ label: "十點半", dealerStand: 8, openingCards: 1 }),
});

const SUITS = Object.freeze(["♠", "♥", "♦", "♣"] as const);
const RANKS = Object.freeze(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const);

export function parseCard(value: string): Card {
  const text = String(value).trim();
  const suit = text.slice(0, 1) as Card["suit"];
  const rank = text.slice(1).toUpperCase() as Card["rank"];
  if (!SUITS.includes(suit) || !RANKS.includes(rank)) {
    throw new Error(`無效的牌：${text}`);
  }
  return Object.freeze({ suit, rank, code: `${suit}${rank}` });
}

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => Object.freeze({ suit, rank, code: `${suit}${rank}` })));
}

export function shuffledDeck(): Card[] {
  const deck = createDeck();
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [deck[index], deck[target]] = [deck[target]!, deck[index]!];
  }
  return deck;
}

export function scoreHand(mode: GameMode, cards: readonly (Card | string)[]): HandScore {
  const list = cards.map((card) => (typeof card === "string" ? parseCard(card) : card));
  if (mode === "blackjack") {
    let total = 0;
    let highAces = 0;
    for (const card of list) {
      if (card.rank === "A") {
        total += 11;
        highAces += 1;
      } else if (["J", "Q", "K"].includes(card.rank)) {
        total += 10;
      } else {
        total += Number(card.rank);
      }
    }
    while (total > 21 && highAces > 0) {
      total -= 10;
      highAces -= 1;
    }
    return Object.freeze({ total, soft: highAces > 0, bust: total > 21 });
  }

  const total = list.reduce((sum, card) => {
    if (card.rank === "A") return sum + 1;
    if (["J", "Q", "K"].includes(card.rank)) return sum + 0.5;
    return sum + Number(card.rank);
  }, 0);
  return Object.freeze({ total, soft: false, bust: total > 10.5 });
}

export function classifyHand(mode: GameMode, cards: readonly (Card | string)[]): ClassifiedHand {
  const score = scoreHand(mode, cards);
  if (score.bust) return Object.freeze({ kind: "bust", rank: 0, score });
  if (mode === "blackjack" && cards.length === 2 && score.total === 21) {
    return Object.freeze({ kind: "blackjack", rank: 2, score });
  }
  if (mode === "tenhalf" && score.total === 10.5) {
    return Object.freeze({ kind: "tenhalf", rank: 3, score });
  }
  if (mode === "tenhalf" && cards.length === 5) {
    return Object.freeze({ kind: "fivedragon", rank: 2, score });
  }
  return Object.freeze({ kind: "points", rank: 1, score });
}

export function compareHands(
  mode: GameMode,
  playerCards: readonly (Card | string)[],
  dealerCards: readonly (Card | string)[],
): GameResult {
  const player = classifyHand(mode, playerCards);
  const dealer = classifyHand(mode, dealerCards);
  let outcome: Outcome = "push";
  if (player.rank !== dealer.rank) outcome = player.rank > dealer.rank ? "player" : "dealer";
  else if (player.score.total !== dealer.score.total) outcome = player.score.total > dealer.score.total ? "player" : "dealer";

  let special: GameResult["special"] = "";
  if (player.kind === "bust") special = "player_bust";
  else if (dealer.kind === "bust") special = "dealer_bust";
  else if (player.kind === "blackjack" || dealer.kind === "blackjack") special = "blackjack";
  else if (player.kind === "tenhalf" || dealer.kind === "tenhalf") special = "tenhalf";
  else if (player.kind === "fivedragon" || dealer.kind === "fivedragon") special = "fivedragon";
  return Object.freeze({ outcome, special, player, dealer });
}

export function visibleDealerCards(state: GameState): Card[] {
  if (state.holeRevealed) return state.dealerCards.slice();
  return state.mode === "blackjack" ? state.dealerCards.slice(0, 1) : [];
}

export function startGame(mode: GameMode, deck: readonly (Card | string)[] = shuffledDeck()): GameState {
  const state: GameState = {
    mode,
    phase: "player_turn",
    deck: deck.map((card) => (typeof card === "string" ? parseCard(card) : card)),
    playerCards: [],
    dealerCards: [],
    holeRevealed: false,
    result: null,
  };
  const openingCards = RULES[mode].openingCards;
  for (let index = 0; index < openingCards; index += 1) {
    state.playerCards.push(drawCard(state));
    state.dealerCards.push(drawCard(state));
  }
  if (classifyHand(mode, state.playerCards).kind === "blackjack") settle(state);
  return state;
}

export function applyAction(state: GameState, action: GameAction): GameResult | null {
  if (state.phase !== "player_turn") throw new Error("這局已結束，請先開始新局。");
  if (action === "stand") return runDealer(state);

  state.playerCards.push(drawCard(state));
  const hand = classifyHand(state.mode, state.playerCards);
  if (hand.kind === "bust") return settle(state);
  if (state.mode === "tenhalf" && (hand.kind === "tenhalf" || hand.kind === "fivedragon")) {
    return runDealer(state);
  }
  return null;
}

function drawCard(state: GameState): Card {
  const card = state.deck.shift();
  if (!card) throw new Error("牌堆已空，無法繼續這局。");
  return card;
}

function shouldDealerDraw(state: GameState): boolean {
  const hand = classifyHand(state.mode, state.dealerCards);
  return hand.kind === "points" && hand.score.total < RULES[state.mode].dealerStand;
}

function runDealer(state: GameState): GameResult {
  state.holeRevealed = true;
  while (shouldDealerDraw(state)) state.dealerCards.push(drawCard(state));
  return settle(state);
}

function settle(state: GameState): GameResult {
  if (state.result) return state.result;
  state.holeRevealed = true;
  state.phase = "ended";
  state.result = compareHands(state.mode, state.playerCards, state.dealerCards);
  return state.result;
}
