import { randomUUID } from "node:crypto";

import {
  applyAction,
  type Card,
  type GameAction,
  type GameMode,
  type GameResult,
  type GameState,
  type Outcome,
  RULES,
  scoreHand,
  shuffledDeck,
  startGame,
  visibleDealerCards,
} from "./game.js";

export interface TableChatMessage {
  readonly speaker: "player";
  readonly text: string;
  readonly at: string;
}

export interface TableView {
  readonly table_id: string;
  readonly mode: GameMode;
  readonly rule_label: string;
  readonly phase: GameState["phase"];
  readonly version: number;
  readonly round: number;
  readonly player_name: string;
  readonly dealer_name: string;
  readonly player_cards: string[];
  readonly player_points: number;
  readonly dealer_cards: string[];
  readonly dealer_points: number | null;
  readonly hole_revealed: boolean;
  readonly legal_actions: Array<GameAction | "new_round">;
  readonly result: {
    readonly outcome: Outcome;
    readonly special: GameResult["special"];
    readonly player_points: number;
    readonly dealer_points: number;
  } | null;
  readonly records: Record<Outcome, number>;
  readonly recent_chat: TableChatMessage[];
}

interface ActionReceipt {
  readonly operation: string;
  readonly view: TableView;
}

interface Table {
  readonly id: string;
  readonly mode: GameMode;
  readonly playerName: string;
  readonly dealerName: string;
  state: GameState;
  version: number;
  round: number;
  readonly records: Record<Outcome, number>;
  readonly chat: TableChatMessage[];
  readonly receipts: Map<string, ActionReceipt>;
}

export type DeckFactory = (mode: GameMode, round: number) => readonly (Card | string)[];

export class TableStore {
  readonly #tables = new Map<string, Table>();
  readonly #deckFactory: DeckFactory;

  constructor(deckFactory: DeckFactory = () => shuffledDeck()) {
    this.#deckFactory = deckFactory;
  }

  joinTable(mode: GameMode, playerName: string, dealerName = "莊家"): TableView {
    const normalizedPlayer = normalizeName(playerName, "玩家");
    const normalizedDealer = normalizeName(dealerName, "莊家");
    const id = randomUUID();
    const round = 1;
    const table: Table = {
      id,
      mode,
      playerName: normalizedPlayer,
      dealerName: normalizedDealer,
      state: startGame(mode, this.#deckFactory(mode, round)),
      version: 1,
      round,
      records: { player: 0, dealer: 0, push: 0 },
      chat: [],
      receipts: new Map(),
    };
    this.#recordFinishedRound(table);
    this.#tables.set(id, table);
    return this.#view(table);
  }

  getTableView(tableId: string): TableView {
    return this.#view(this.#requireTable(tableId));
  }

  takeAction(
    tableId: string,
    action: GameAction,
    expectedVersion: number,
    idempotencyKey: string,
  ): TableView {
    const table = this.#requireTable(tableId);
    const operation = `take_action:${action}`;
    const replay = this.#replay(table, idempotencyKey, operation);
    if (replay) return replay;
    this.#assertVersion(table, expectedVersion);
    applyAction(table.state, action);
    table.version += 1;
    this.#recordFinishedRound(table);
    return this.#remember(table, idempotencyKey, operation);
  }

  startNewRound(tableId: string, expectedVersion: number, idempotencyKey: string): TableView {
    const table = this.#requireTable(tableId);
    const operation = "start_new_round";
    const replay = this.#replay(table, idempotencyKey, operation);
    if (replay) return replay;
    this.#assertVersion(table, expectedVersion);
    if (table.state.phase !== "ended") throw new Error("目前牌局還沒結束，不能開始新局。");
    table.round += 1;
    table.state = startGame(table.mode, this.#deckFactory(table.mode, table.round));
    table.version += 1;
    this.#recordFinishedRound(table);
    return this.#remember(table, idempotencyKey, operation);
  }

  sayAtTable(tableId: string, text: string, expectedVersion: number, idempotencyKey: string): TableView {
    const table = this.#requireTable(tableId);
    const normalized = text.trim().slice(0, 500);
    if (!normalized) throw new Error("台詞不能是空白。");
    const operation = `say_at_table:${normalized}`;
    const replay = this.#replay(table, idempotencyKey, operation);
    if (replay) return replay;
    this.#assertVersion(table, expectedVersion);
    table.chat.push({ speaker: "player", text: normalized, at: new Date().toISOString() });
    if (table.chat.length > 100) table.chat.splice(0, table.chat.length - 100);
    table.version += 1;
    return this.#remember(table, idempotencyKey, operation);
  }

  #requireTable(tableId: string): Table {
    const table = this.#tables.get(tableId);
    if (!table) throw new Error("找不到這張牌桌；MCP Server 重啟後，記憶體牌桌會消失。");
    return table;
  }

  #assertVersion(table: Table, expectedVersion: number): void {
    if (table.version !== expectedVersion) {
      throw new Error(`牌桌版本衝突：目前是 ${table.version}，不是 ${expectedVersion}。請重新讀取牌桌後再決定。`);
    }
  }

  #recordFinishedRound(table: Table): void {
    if (!table.state.result) return;
    const receiptKey = `round:${table.round}:recorded`;
    if (table.receipts.has(receiptKey)) return;
    table.records[table.state.result.outcome] += 1;
    table.receipts.set(receiptKey, { operation: receiptKey, view: this.#view(table) });
  }

  #replay(table: Table, key: string, operation: string): TableView | null {
    const receipt = table.receipts.get(key);
    if (!receipt) return null;
    if (receipt.operation !== operation) throw new Error("同一個 idempotency_key 已用於不同操作。");
    return structuredClone(receipt.view);
  }

  #remember(table: Table, key: string, operation: string): TableView {
    const view = this.#view(table);
    table.receipts.set(key, { operation, view: structuredClone(view) });
    return view;
  }

  #view(table: Table): TableView {
    const dealerCards = visibleDealerCards(table.state);
    const dealerPoints = dealerCards.length ? scoreHand(table.mode, dealerCards).total : null;
    const result = table.state.result
      ? {
          outcome: table.state.result.outcome,
          special: table.state.result.special,
          player_points: table.state.result.player.score.total,
          dealer_points: table.state.result.dealer.score.total,
        }
      : null;
    return {
      table_id: table.id,
      mode: table.mode,
      rule_label: RULES[table.mode].label,
      phase: table.state.phase,
      version: table.version,
      round: table.round,
      player_name: table.playerName,
      dealer_name: table.dealerName,
      player_cards: table.state.playerCards.map((card) => card.code),
      player_points: scoreHand(table.mode, table.state.playerCards).total,
      dealer_cards: dealerCards.map((card) => card.code),
      dealer_points: dealerPoints,
      hole_revealed: table.state.holeRevealed,
      legal_actions: table.state.phase === "player_turn" ? ["hit", "stand"] : ["new_round"],
      result,
      records: { ...table.records },
      recent_chat: table.chat.slice(-20).map((message) => ({ ...message })),
    };
  }
}

function normalizeName(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, 80);
  return normalized || fallback;
}
