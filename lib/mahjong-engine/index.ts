/**
 * 麻雀エンジン — @pai-forge/riichi-mahjong 統合版
 * 仕様書 Section 3 準拠: 4人麻雀・東風戦・赤ドラあり・喰いタンあり・頭ハネ
 */

import {
  calculateShanten,
  getUkeire,
  detectYaku,
  calculateScoreForTehai,
  assertTehai13,
  assertTehai14,
  getDoraNext,
  HaiKind,
  NoYakuError,
  isMenzen,
} from '@pai-forge/riichi-mahjong';
import type {
  HaiKindId,
  Tehai,
  Tehai13,
  Tehai14,
  DetectYakuConfig,
  ScoreCalculationConfig,
  ScoreResult,
  Payment,
  Kazehai,
  CompletedMentsu,
  Furo,
} from '@pai-forge/riichi-mahjong';

// ============================================================
// Part 1: 牌の型定義・定数
// ============================================================

export type TileSuit = 'm' | 'p' | 's' | 'z';

/** 副露の型 */
export interface Meld {
  type: 'chi' | 'pon' | 'daiminkan' | 'kakan' | 'ankan';
  tiles: string[];
  fromSeat?: number;
  calledTile?: string;
}

/** プレイヤー状態 */
export interface PlayerState {
  seat: number;
  hand: string[];
  melds: Meld[];
  discards: string[];
  riichi: boolean;
  riichiTurn?: number;
  score: number;
  tsumo?: string;
}

/** 和了結果 */
export interface WinResult {
  type: 'tsumo' | 'ron';
  winnerSeat: number;
  loserSeat?: number;
  yaku: [string, number][];
  han: number;
  fu: number;
  scoreLevel: string;
  payment: Payment;
  totalPoints: number;
  scoreChanges: [number, number, number, number];
}

/** 局の結果 */
export interface HandResult {
  type: 'agari' | 'ryukyoku';
  winResult?: WinResult;
  tenpaiSeats?: number[];
  scoreChanges: [number, number, number, number];
  dealerRetains: boolean;
}

/** ゲーム全体の状態（外部公開用） */
export interface GameState {
  round: string;
  handNumber: number;
  honba: number;
  kyotaku: number;
  dealerSeat: number;
  currentTurn: number;
  currentActor: number;
  players: PlayerState[];
  doraIndicators: string[];
  remainingTiles: number;
  isHandFinished: boolean;
  isGameFinished: boolean;
  phase: 'draw' | 'discard' | 'call' | 'finished';
  lastDiscard: { tile: string; seat: number } | null;
}

// 全牌136枚（赤ドラ含む）
const ALL_TILES: string[] = [];
const suits: TileSuit[] = ['m', 'p', 's'];
const honors = ['1z', '2z', '3z', '4z', '5z', '6z', '7z'];

suits.forEach(suit => {
  for (let num = 1; num <= 9; num++) {
    for (let i = 0; i < 4; i++) {
      if (num === 5 && i === 0) {
        ALL_TILES.push(`0${suit}`); // 赤5
      } else {
        ALL_TILES.push(`${num}${suit}`);
      }
    }
  }
});
honors.forEach(tile => {
  for (let i = 0; i < 4; i++) ALL_TILES.push(tile);
});

// ============================================================
// Part 2: 牌変換ユーティリティ
// ============================================================

/** 文字列牌 → HaiKindId (0-33) */
export function tileToKindId(tile: string): HaiKindId {
  const suit = tile.slice(-1);
  let num = parseInt(tile.slice(0, -1));
  if (num === 0) num = 5; // 赤5 → 5

  let kindId: number;
  switch (suit) {
    case 'm': kindId = num - 1; break;       // 0-8
    case 'p': kindId = num - 1 + 9; break;   // 9-17
    case 's': kindId = num - 1 + 18; break;  // 18-26
    case 'z': kindId = num - 1 + 27; break;  // 27-33
    default: kindId = 0;
  }
  return kindId as HaiKindId;
}

/** HaiKindId → 文字列牌（赤なし） */
export function kindIdToTile(kindId: number): string {
  if (kindId <= 8) return `${kindId + 1}m`;
  if (kindId <= 17) return `${kindId - 8}p`;
  if (kindId <= 26) return `${kindId - 17}s`;
  return `${kindId - 26}z`;
}

/** 席 → 自風の HaiKindId */
function seatToKaze(seat: number, dealerSeat: number): Kazehai {
  const winds = [HaiKind.Ton, HaiKind.Nan, HaiKind.Sha, HaiKind.Pei];
  return winds[(seat - dealerSeat + 4) % 4] as Kazehai;
}

/** 手牌をTehai用のHaiKindId配列に変換 */
function handToKindIds(tiles: string[]): HaiKindId[] {
  return tiles.map(t => tileToKindId(t));
}

/** Meld → ライブラリ用 CompletedMentsu */
function meldToLibMentsu(meld: Meld): CompletedMentsu {
  const hais = meld.tiles.map(t => tileToKindId(t)) as any;
  const from = meld.fromSeat !== undefined ? ((meld.fromSeat % 3) + 1) : 1;

  if (meld.type === 'chi') {
    return {
      type: 'Shuntsu' as const,
      hais: hais.slice(0, 3),
      furo: { type: 'Chi' as const, from } as Furo,
    } as any;
  }
  if (meld.type === 'pon') {
    return {
      type: 'Koutsu' as const,
      hais: hais.slice(0, 3),
      furo: { type: 'Pon' as const, from } as Furo,
    } as any;
  }
  // daiminkan, kakan
  if (meld.type === 'daiminkan' || meld.type === 'kakan') {
    return {
      type: 'Kantsu' as const,
      hais: hais.slice(0, 4),
      furo: { type: meld.type === 'daiminkan' ? 'Daiminkan' : 'Kakan', from } as any as Furo,
    } as any;
  }
  // ankan — no furo
  return {
    type: 'Kantsu' as const,
    hais: hais.slice(0, 4),
  } as any;
}

/** 赤ドラ枚数を数える */
function countRedDora(tiles: string[]): number {
  return tiles.filter(t => t.startsWith('0')).length;
}

// ============================================================
// Part 3: ヘルパー関数
// ============================================================

function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function compareTiles(a: string, b: string): number {
  const suitOrder: Record<string, number> = { m: 0, p: 1, s: 2, z: 3 };
  const suitA = a.slice(-1);
  const suitB = b.slice(-1);
  const numA = parseInt(a.slice(0, -1)) || 0;
  const numB = parseInt(b.slice(0, -1)) || 0;
  if (suitA !== suitB) return suitOrder[suitA] - suitOrder[suitB];
  return numA - numB;
}

/** 牌の一致判定（赤ドラ考慮: 0m == 5m） */
function tilesMatch(a: string, b: string): boolean {
  const normA = a.startsWith('0') ? '5' + a.slice(-1) : a;
  const normB = b.startsWith('0') ? '5' + b.slice(-1) : b;
  return normA === normB;
}

/** 九種九牌チェック: 配牌+最初のツモで么九牌が9種以上 */
function isKyushukyuhai(hand: string[], tsumo: string): boolean {
  const all = [...hand, tsumo];
  const yaochuSet = new Set<string>();
  for (const tile of all) {
    const suit = tile.slice(-1);
    const num = parseInt(tile.slice(0, -1));
    const isYaochu = suit === 'z' || num === 1 || num === 9 || num === 0; // 0=赤5, not yaochu
    if (suit === 'z') yaochuSet.add(tile);
    else if (num === 1 || num === 9) yaochuSet.add(`${num}${suit}`);
  }
  return yaochuSet.size >= 9;
}

// ============================================================
// Part 4: MahjongEngine クラス
// ============================================================

export class MahjongEngine {
  // ゲーム全体の状態
  private handNumber: number = 0;   // 0=東1局, 1=東2局, 2=東3局, 3=東4局
  private honba: number = 0;
  private kyotaku: number = 0;
  private dealerSeat: number = 0;
  private gameFinished: boolean = false;

  // 局内の状態
  private wall: string[] = [];
  private deadWall: string[] = [];
  private players: PlayerState[] = [];
  private currentActor: number = 0;
  private phase: 'draw' | 'discard' | 'call' | 'finished' = 'draw';
  private doraIndicators: string[] = [];
  private uraDoraIndicators: string[] = [];
  private lastDiscard: { tile: string; seat: number } | null = null;
  private turnCount: number = 0;
  private handFinished: boolean = false;
  private firstTurnFlags: boolean[] = [true, true, true, true]; // 各席の第一ツモフラグ
  private rinshanTiles: string[] = [];
  private pendingDoraIndicators: string[] = [];
  private pendingUraDoraIndicators: string[] = [];
  private kanCount: number = 0;

  constructor() {
    this.initPlayers();
    this.startNewHand();
  }

  private initPlayers(): void {
    this.players = Array.from({ length: 4 }, (_, i) => ({
      seat: i,
      hand: [],
      melds: [],
      discards: [],
      riichi: false,
      score: 25000,
      tsumo: undefined,
    }));
  }

  // --------------------------------------------------------
  // 局の開始
  // --------------------------------------------------------
  startNewHand(): void {
    const shuffled = shuffle([...ALL_TILES]);

    // 各プレイヤーに13枚配牌
    for (let i = 0; i < 4; i++) {
      this.players[i].hand = shuffled.splice(0, 13).sort(compareTiles);
      this.players[i].melds = [];
      this.players[i].discards = [];
      this.players[i].riichi = false;
      this.players[i].riichiTurn = undefined;
      this.players[i].tsumo = undefined;
    }

    // 王牌（14枚）
    // [ドラ1][裏ドラ1][ドラ2][裏ドラ2][ドラ3][裏ドラ3][ドラ4][裏ドラ4][ドラ5][裏ドラ5][嶺上1][嶺上2][嶺上3][嶺上4]
    const deadWallTiles = shuffled.splice(0, 14);
    this.doraIndicators = [deadWallTiles[0]];
    this.uraDoraIndicators = [deadWallTiles[1]];
    this.pendingDoraIndicators = [deadWallTiles[2], deadWallTiles[4], deadWallTiles[6], deadWallTiles[8]];
    this.pendingUraDoraIndicators = [deadWallTiles[3], deadWallTiles[5], deadWallTiles[7], deadWallTiles[9]];
    this.rinshanTiles = [deadWallTiles[10], deadWallTiles[11], deadWallTiles[12], deadWallTiles[13]];
    this.kanCount = 0;

    this.wall = shuffled;
    this.deadWall = deadWallTiles;
    this.currentActor = this.dealerSeat;
    this.phase = 'draw';
    this.lastDiscard = null;
    this.turnCount = 0;
    this.handFinished = false;
    this.firstTurnFlags = [true, true, true, true];
  }

  // --------------------------------------------------------
  // 状態取得
  // --------------------------------------------------------
  getState(): GameState {
    return {
      round: `東${this.handNumber + 1}局`,
      handNumber: this.handNumber,
      honba: this.honba,
      kyotaku: this.kyotaku,
      dealerSeat: this.dealerSeat,
      currentTurn: this.turnCount,
      currentActor: this.currentActor,
      players: this.players.map(p => ({
        ...p,
        hand: [...p.hand],
        melds: p.melds.map(m => ({ ...m, tiles: [...m.tiles] })),
        discards: [...p.discards],
      })),
      doraIndicators: [...this.doraIndicators],
      remainingTiles: this.wall.length,
      isHandFinished: this.handFinished,
      isGameFinished: this.gameFinished,
      phase: this.phase,
      lastDiscard: this.lastDiscard ? { ...this.lastDiscard } : null,
    };
  }

  getRoundString(): string {
    return `東${this.handNumber + 1}局`;
  }

  getHonba(): number { return this.honba; }
  getKyotaku(): number { return this.kyotaku; }
  getDealerSeat(): number { return this.dealerSeat; }
  isHandOver(): boolean { return this.handFinished; }
  isGameOver(): boolean { return this.gameFinished; }
  getHandNumber(): number { return this.handNumber; }

  // --------------------------------------------------------
  // ツモ（牌を引く）
  // --------------------------------------------------------
  draw(): string | null {
    if (this.wall.length === 0) return null;
    const tile = this.wall.shift()!;
    this.players[this.currentActor].tsumo = tile;
    this.phase = 'discard';
    return tile;
  }

  // --------------------------------------------------------
  // 打牌
  // --------------------------------------------------------
  discard(tile: string): boolean {
    const player = this.players[this.currentActor];

    if (player.tsumo === tile) {
      // ツモ切り
      player.discards.push(tile);
      player.tsumo = undefined;
    } else {
      // 手出し
      const idx = player.hand.findIndex(t => t === tile);
      if (idx === -1) {
        // 赤ドラ考慮で再検索
        const idxMatch = player.hand.findIndex(t => tilesMatch(t, tile));
        if (idxMatch === -1) return false;
        const actualTile = player.hand[idxMatch];
        if (player.tsumo) {
          player.hand.push(player.tsumo);
          player.tsumo = undefined;
        }
        player.hand.splice(idxMatch, 1);
        player.hand.sort(compareTiles);
        player.discards.push(actualTile);
      } else {
        if (player.tsumo) {
          player.hand.push(player.tsumo);
          player.tsumo = undefined;
        }
        player.hand.splice(idx, 1);
        player.hand.sort(compareTiles);
        player.discards.push(tile);
      }
    }

    this.lastDiscard = { tile, seat: this.currentActor };
    this.phase = 'call';
    this.firstTurnFlags[this.currentActor] = false;
    return true;
  }

  // --------------------------------------------------------
  // 次のプレイヤーへ
  // --------------------------------------------------------
  nextTurn(): void {
    this.currentActor = (this.currentActor + 1) % 4;
    this.turnCount++;
    this.phase = 'draw';
  }

  // --------------------------------------------------------
  // 和了判定 — @pai-forge/riichi-mahjong 使用
  // --------------------------------------------------------

  /** ツモ和了可能か */
  canTsumo(seat: number): boolean {
    const player = this.players[seat];
    if (!player.tsumo) return false;
    return this.checkWin(seat, player.tsumo, true);
  }

  /** ロン可能か（フリテンチェック含む） */
  canRon(seat: number, tile: string): boolean {
    const player = this.players[seat];
    // フリテンチェック: 自分の捨て牌に待ち牌がある場合はロン不可
    if (this.isFuriten(seat)) return false;
    // リーチ後のフリテン: 一度見逃した牌と同じ種類はロン不可
    return this.checkWin(seat, tile, false);
  }

  /** 内部: 和了判定 */
  private checkWin(seat: number, agariTile: string, isTsumo: boolean): boolean {
    const player = this.players[seat];

    try {
      // 手牌(13枚) + 和了牌 → 14枚
      const closedKindIds = handToKindIds(player.hand);
      const agariKindId = tileToKindId(agariTile);
      const allClosed = [...closedKindIds, agariKindId];

      const exposedMentsu = player.melds.map(m => meldToLibMentsu(m));

      const tehai = { closed: allClosed, exposed: exposedMentsu } as unknown as Tehai14;

      // assertTehai14 でバリデーション（14枚チェック）
      try {
        assertTehai14(tehai);
      } catch {
        return false; // 枚数不正
      }

      const config: DetectYakuConfig = {
        agariHai: agariKindId,
        bakaze: HaiKind.Ton as Kazehai, // 東風戦は常に東
        jikaze: seatToKaze(seat, this.dealerSeat),
        doraMarkers: this.doraIndicators.map(t => tileToKindId(t)),
        isTsumo,
      };

      const yakuResult = detectYaku(tehai, config);
      return yakuResult.length > 0;
    } catch (e: any) {
      if (e?.constructor?.name === 'NoYakuError' || e?.message?.includes('yaku')) {
        // 和了形だが役なし → リーチなら立直が役になる
        return this.players[seat].riichi;
      }
      // 和了形ではない
      return false;
    }
  }

  // --------------------------------------------------------
  // 点数計算
  // --------------------------------------------------------
  calculateWin(seat: number, isTsumo: boolean, agariTile: string): WinResult | null {
    const player = this.players[seat];

    try {
      const closedKindIds = handToKindIds(player.hand);
      const agariKindId = tileToKindId(agariTile);
      const allClosed = [...closedKindIds, agariKindId];
      const exposedMentsu = player.melds.map(m => meldToLibMentsu(m));
      const tehai = { closed: allClosed, exposed: exposedMentsu } as unknown as Tehai14;

      try {
        assertTehai14(tehai);
      } catch {
        return null;
      }

      const config: ScoreCalculationConfig = {
        agariHai: agariKindId,
        isTsumo,
        jikaze: seatToKaze(seat, this.dealerSeat),
        bakaze: HaiKind.Ton as Kazehai,
        doraMarkers: this.doraIndicators.map(t => tileToKindId(t)),
        uraDoraMarkers: player.riichi
          ? this.uraDoraIndicators.map(t => tileToKindId(t))
          : [],
      };

      const scoreResult = calculateScoreForTehai(tehai, config);

      // ライブラリの結果から役名リストを取得
      const yakuList: [string, number][] = scoreResult.detail?.yakuResult
        ? scoreResult.detail.yakuResult.map(([name, han]) => [name, han as number])
        : [];

      // リーチ加算
      let extraHan = 0;
      if (player.riichi) {
        yakuList.push(['Riichi', 1]);
        extraHan += 1;
      }

      // 赤ドラ加算
      const allTiles = [...player.hand, agariTile, ...player.melds.flatMap(m => m.tiles)];
      const redDora = countRedDora(allTiles);
      if (redDora > 0) {
        yakuList.push(['赤ドラ', redDora]);
        extraHan += redDora;
      }

      // 最終的な翻数
      const totalHan = scoreResult.han + extraHan;
      const fu = scoreResult.fu;

      // 支払い計算（追加翻がある場合は自前で再計算）
      let payment = scoreResult.payment;
      let totalPoints: number;

      if (extraHan > 0) {
        // 簡易再計算
        const isDealer = seat === this.dealerSeat;
        totalPoints = calculatePaymentFromHanFu(totalHan, fu, isDealer, isTsumo);
        payment = buildPayment(totalPoints, isDealer, isTsumo);
      } else {
        totalPoints = getPaymentTotal(payment);
      }

      // 本場加算
      totalPoints += this.honba * 300;

      // 供託取得
      totalPoints += this.kyotaku * 1000;

      // 点数移動を計算
      const scoreChanges: [number, number, number, number] = [0, 0, 0, 0];
      scoreChanges[seat] = totalPoints;

      if (isTsumo) {
        const isDealer = seat === this.dealerSeat;
        if (isDealer) {
          // 親ツモ: 子3人が均等払い
          const perChild = Math.ceil(totalPoints / 3 / 100) * 100;
          for (let i = 0; i < 4; i++) {
            if (i !== seat) scoreChanges[i] = -perChild;
          }
          scoreChanges[seat] = perChild * 3;
        } else {
          // 子ツモ: 親は高め、子は低め
          const base = calculatePaymentFromHanFu(totalHan, fu, false, true);
          const childPay = Math.ceil(base / 4 / 100) * 100;
          const dealerPay = Math.ceil(base / 2 / 100) * 100;
          for (let i = 0; i < 4; i++) {
            if (i === seat) continue;
            scoreChanges[i] = i === this.dealerSeat ? -(dealerPay + this.honba * 100) : -(childPay + this.honba * 100);
          }
          scoreChanges[seat] = -scoreChanges.filter((_, i) => i !== seat).reduce((a, b) => a + b, 0);
        }
      } else {
        // ロン: 振り込み者が全額払い
        const loserSeat = this.lastDiscard!.seat;
        const ronBase = calculatePaymentFromHanFu(totalHan, fu, seat === this.dealerSeat, false);
        const ronTotal = ronBase + this.honba * 300 + this.kyotaku * 1000;
        scoreChanges[loserSeat] = -ronBase - this.honba * 300;
        scoreChanges[seat] = ronTotal;
      }

      return {
        type: isTsumo ? 'tsumo' : 'ron',
        winnerSeat: seat,
        loserSeat: isTsumo ? undefined : this.lastDiscard?.seat,
        yaku: yakuList,
        han: totalHan,
        fu,
        scoreLevel: scoreResult.scoreLevel,
        payment,
        totalPoints,
        scoreChanges,
      };
    } catch (e: any) {
      // NoYakuError でもリーチ役で和了
      if (player.riichi && (e?.constructor?.name === 'NoYakuError' || e?.message?.includes('yaku'))) {
        return this.buildRiichiOnlyWin(seat, isTsumo, agariTile);
      }
      console.error('Score calculation error:', e);
      return null;
    }
  }

  /** リーチのみの和了（構造役なし） */
  private buildRiichiOnlyWin(seat: number, isTsumo: boolean, agariTile: string): WinResult {
    const han = 1 + countRedDora([...this.players[seat].hand, agariTile]);
    const fu = 30;
    const isDealer = seat === this.dealerSeat;
    const base = calculatePaymentFromHanFu(han, fu, isDealer, isTsumo);
    const total = base + this.honba * 300 + this.kyotaku * 1000;

    const yakuList: [string, number][] = [['Riichi', 1]];
    const red = countRedDora([...this.players[seat].hand, agariTile]);
    if (red > 0) yakuList.push(['赤ドラ', red]);

    const scoreChanges: [number, number, number, number] = [0, 0, 0, 0];
    if (isTsumo) {
      const perPerson = Math.ceil(base / (isDealer ? 3 : 4) / 100) * 100;
      for (let i = 0; i < 4; i++) {
        if (i !== seat) scoreChanges[i] = -(perPerson + this.honba * 100);
      }
      scoreChanges[seat] = -scoreChanges.filter((_, i) => i !== seat).reduce((a, b) => a + b, 0) + this.kyotaku * 1000;
    } else {
      const loser = this.lastDiscard!.seat;
      scoreChanges[loser] = -(base + this.honba * 300);
      scoreChanges[seat] = total;
    }

    return {
      type: isTsumo ? 'tsumo' : 'ron',
      winnerSeat: seat,
      loserSeat: isTsumo ? undefined : this.lastDiscard?.seat,
      yaku: yakuList,
      han,
      fu,
      scoreLevel: han >= 5 ? 'Mangan' : 'Normal',
      payment: buildPayment(base, isDealer, isTsumo),
      totalPoints: total,
      scoreChanges,
    };
  }

  // --------------------------------------------------------
  // 聴牌判定 — シャンテン計算
  // --------------------------------------------------------
  isTenpai(seat: number): boolean {
    const player = this.players[seat];
    try {
      const kindIds = handToKindIds(player.hand);
      const exposed = player.melds.map(m => meldToLibMentsu(m));
      const tehai = { closed: kindIds, exposed } as unknown as Tehai13;
      assertTehai13(tehai);
      return calculateShanten(tehai) === 0;
    } catch {
      return false;
    }
  }

  /** 待ち牌を取得 */
  getWaitingTiles(seat: number): string[] {
    const player = this.players[seat];
    try {
      const kindIds = handToKindIds(player.hand);
      const exposed = player.melds.map(m => meldToLibMentsu(m));
      const tehai = { closed: kindIds, exposed } as unknown as Tehai13;
      assertTehai13(tehai);
      if (calculateShanten(tehai) !== 0) return [];
      const ukeire = getUkeire(tehai);
      return ukeire.map(k => kindIdToTile(k));
    } catch {
      return [];
    }
  }

  // --------------------------------------------------------
  // フリテン判定
  // --------------------------------------------------------
  private isFuriten(seat: number): boolean {
    const player = this.players[seat];
    const waitingTiles = this.getWaitingTiles(seat);
    if (waitingTiles.length === 0) return false;

    // 自分の捨て牌に待ち牌がある → フリテン
    for (const discard of player.discards) {
      for (const wait of waitingTiles) {
        if (tilesMatch(discard, wait)) return true;
      }
    }
    return false;
  }

  // --------------------------------------------------------
  // リーチ判定・実行
  // --------------------------------------------------------
  canRiichi(seat: number): boolean {
    const player = this.players[seat];
    if (player.riichi) return false;
    if (player.melds.some(m => m.type !== 'ankan')) return false; // 門前でない
    if (player.score < 1000) return false;
    if (this.wall.length < 4) return false;
    return this.isTenpai(seat);
  }

  /** リーチで切れる牌（切った後もテンパイが維持される牌） */
  getRiichiDiscardCandidates(seat: number): string[] {
    if (!this.canRiichi(seat)) return [];
    const player = this.players[seat];
    const allTiles = [...player.hand];
    if (player.tsumo) allTiles.push(player.tsumo);

    const candidates: string[] = [];
    const seen = new Set<string>();

    for (const tile of allTiles) {
      const norm = tile.startsWith('0') ? '5' + tile.slice(-1) : tile;
      if (seen.has(norm)) continue;
      seen.add(norm);

      // この牌を切った後の手牌でテンパイかチェック
      const remaining = [...allTiles];
      const idx = remaining.indexOf(tile);
      if (idx >= 0) remaining.splice(idx, 1);

      try {
        const kindIds = handToKindIds(remaining);
        const exposed = player.melds.map(m => meldToLibMentsu(m));
        const tehai = { closed: kindIds, exposed } as unknown as Tehai13;
        assertTehai13(tehai);
        if (calculateShanten(tehai) === 0) {
          candidates.push(tile);
        }
      } catch { /* skip */ }
    }

    return candidates;
  }

  executeRiichi(seat: number, discardTile: string): boolean {
    if (!this.canRiichi(seat)) return false;
    const player = this.players[seat];
    player.riichi = true;
    player.riichiTurn = this.turnCount;
    player.score -= 1000;
    this.kyotaku++;
    return this.discard(discardTile);
  }

  // --------------------------------------------------------
  // ポン判定・実行
  // --------------------------------------------------------
  canPon(seat: number, tile: string): boolean {
    if (seat === this.currentActor) return false;
    const player = this.players[seat];
    if (player.riichi) return false; // リーチ中は鳴けない
    const count = player.hand.filter(t => tilesMatch(t, tile)).length;
    return count >= 2;
  }

  executePon(seat: number, tile: string): boolean {
    if (!this.canPon(seat, tile)) return false;
    const player = this.players[seat];
    const fromSeat = this.lastDiscard!.seat;

    // 手牌から2枚取り出す
    const meldTiles: string[] = [tile]; // 鳴いた牌
    let taken = 0;
    const newHand: string[] = [];
    for (const t of player.hand) {
      if (taken < 2 && tilesMatch(t, tile)) {
        meldTiles.push(t);
        taken++;
      } else {
        newHand.push(t);
      }
    }

    player.hand = newHand;
    player.melds.push({
      type: 'pon',
      tiles: meldTiles,
      fromSeat,
      calledTile: tile,
    });

    // 捨て牌から鳴いた牌を除去（最後の牌）
    const discards = this.players[fromSeat].discards;
    if (discards.length > 0 && discards[discards.length - 1] === tile) {
      discards.pop();
    }

    this.currentActor = seat;
    this.phase = 'discard';
    this.firstTurnFlags[seat] = false;
    return true;
  }

  // --------------------------------------------------------
  // チー判定・実行
  // --------------------------------------------------------
  canChi(seat: number, tile: string): boolean {
    // チーは上家（左隣）からのみ
    if ((this.lastDiscard!.seat + 1) % 4 !== seat) return false;
    const player = this.players[seat];
    if (player.riichi) return false;
    return this.getChiOptions(seat, tile).length > 0;
  }

  getChiOptions(seat: number, tile: string): string[][] {
    const options: string[][] = [];
    const suit = tile.slice(-1);
    if (suit === 'z') return options;

    let num = parseInt(tile.slice(0, -1));
    if (num === 0) num = 5; // 赤5
    const hand = this.players[seat].hand;

    const patterns = [
      [num - 2, num - 1],
      [num - 1, num + 1],
      [num + 1, num + 2],
    ];

    for (const [a, b] of patterns) {
      if (a >= 1 && a <= 9 && b >= 1 && b <= 9) {
        const tileA = hand.find(t => {
          const s = t.slice(-1);
          let n = parseInt(t.slice(0, -1));
          if (n === 0) n = 5;
          return s === suit && n === a;
        });
        const tileB = hand.find(t => {
          const s = t.slice(-1);
          let n = parseInt(t.slice(0, -1));
          if (n === 0) n = 5;
          return s === suit && n === b && t !== tileA;
        });
        if (tileA && tileB) {
          options.push([tileA, tile, tileB].sort(compareTiles));
        }
      }
    }
    return options;
  }

  executeChi(seat: number, tiles: string[]): boolean {
    const player = this.players[seat];
    const fromSeat = this.lastDiscard!.seat;
    const calledTile = this.lastDiscard!.tile;

    // 手牌から鳴いた牌以外の2枚を取り出す
    const newHand = [...player.hand];
    const meldTiles: string[] = [calledTile];

    for (const t of tiles) {
      if (t === calledTile) continue;
      const idx = newHand.findIndex(h => h === t);
      if (idx === -1) return false;
      meldTiles.push(newHand.splice(idx, 1)[0]);
    }

    player.hand = newHand;
    player.melds.push({
      type: 'chi',
      tiles: meldTiles.sort(compareTiles),
      fromSeat,
      calledTile,
    });

    // 捨て牌から鳴いた牌を除去
    const discards = this.players[fromSeat].discards;
    if (discards.length > 0 && discards[discards.length - 1] === calledTile) {
      discards.pop();
    }

    this.currentActor = seat;
    this.phase = 'discard';
    this.firstTurnFlags[seat] = false;
    return true;
  }

  // --------------------------------------------------------
  // カン関連ヘルパー
  // --------------------------------------------------------

  /** 嶺上牌をツモる */
  private drawRinshan(): string | null {
    if (this.rinshanTiles.length === 0) return null;
    return this.rinshanTiles.shift()!;
  }

  /** 新ドラを追加 */
  private flipNewDora(): void {
    if (this.pendingDoraIndicators.length > 0) {
      this.doraIndicators.push(this.pendingDoraIndicators.shift()!);
      this.uraDoraIndicators.push(this.pendingUraDoraIndicators.shift()!);
    }
  }

  getKanCount(): number { return this.kanCount; }

  // --------------------------------------------------------
  // 暗槓 (Ankan) — 手牌に同じ牌が4枚
  // --------------------------------------------------------

  canAnkan(seat: number): boolean {
    const player = this.players[seat];
    if (player.riichi) return false; // MVP: リーチ中は暗槓不可
    if (this.kanCount >= 4) return false;
    if (this.rinshanTiles.length === 0) return false;
    return this.getAnkanCandidates(seat).length > 0;
  }

  getAnkanCandidates(seat: number): string[] {
    const player = this.players[seat];
    const allTiles = [...player.hand];
    if (player.tsumo) allTiles.push(player.tsumo);

    const counts = new Map<string, number>();
    for (const tile of allTiles) {
      const norm = tile.startsWith('0') ? '5' + tile.slice(-1) : tile;
      counts.set(norm, (counts.get(norm) || 0) + 1);
    }

    const candidates: string[] = [];
    for (const [norm, count] of counts) {
      if (count >= 4) candidates.push(norm);
    }
    return candidates;
  }

  executeAnkan(seat: number, tileNorm: string): boolean {
    if (this.kanCount >= 4 || this.rinshanTiles.length === 0) return false;
    const player = this.players[seat];

    const allTiles = [...player.hand];
    if (player.tsumo) allTiles.push(player.tsumo);

    const meldTiles: string[] = [];
    const remaining: string[] = [];

    for (const tile of allTiles) {
      const norm = tile.startsWith('0') ? '5' + tile.slice(-1) : tile;
      if (norm === tileNorm && meldTiles.length < 4) {
        meldTiles.push(tile);
      } else {
        remaining.push(tile);
      }
    }

    if (meldTiles.length < 4) return false;

    player.hand = remaining.sort(compareTiles);
    player.tsumo = undefined;
    player.melds.push({
      type: 'ankan',
      tiles: meldTiles,
    });

    this.kanCount++;
    this.flipNewDora();

    const rinshan = this.drawRinshan();
    if (rinshan) {
      player.tsumo = rinshan;
      this.phase = 'discard';
    }

    return true;
  }

  // --------------------------------------------------------
  // 加槓 (Kakan) — ポン済み面子に4枚目を追加
  // --------------------------------------------------------

  canKakan(seat: number): boolean {
    const player = this.players[seat];
    if (this.kanCount >= 4) return false;
    if (this.rinshanTiles.length === 0) return false;
    return this.getKakanCandidates(seat).length > 0;
  }

  getKakanCandidates(seat: number): string[] {
    const player = this.players[seat];
    const candidates: string[] = [];

    const allTiles = [...player.hand];
    if (player.tsumo) allTiles.push(player.tsumo);

    for (const meld of player.melds) {
      if (meld.type === 'pon') {
        const ponNorm = meld.tiles[0].startsWith('0') ? '5' + meld.tiles[0].slice(-1) : meld.tiles[0];
        for (const tile of allTiles) {
          const tileNorm = tile.startsWith('0') ? '5' + tile.slice(-1) : tile;
          if (tileNorm === ponNorm) {
            candidates.push(tile);
            break;
          }
        }
      }
    }
    return candidates;
  }

  executeKakan(seat: number, tile: string): boolean {
    if (this.kanCount >= 4 || this.rinshanTiles.length === 0) return false;
    const player = this.players[seat];
    const tileNorm = tile.startsWith('0') ? '5' + tile.slice(-1) : tile;

    const meldIndex = player.melds.findIndex(m => {
      if (m.type !== 'pon') return false;
      const meldNorm = m.tiles[0].startsWith('0') ? '5' + m.tiles[0].slice(-1) : m.tiles[0];
      return meldNorm === tileNorm;
    });

    if (meldIndex === -1) return false;

    // 手牌/ツモから牌を取り出す
    if (player.tsumo === tile) {
      player.tsumo = undefined;
    } else {
      const idx = player.hand.indexOf(tile);
      if (idx === -1) return false;
      player.hand.splice(idx, 1);
      if (player.tsumo) {
        player.hand.push(player.tsumo);
        player.tsumo = undefined;
        player.hand.sort(compareTiles);
      }
    }

    player.melds[meldIndex].type = 'kakan';
    player.melds[meldIndex].tiles.push(tile);

    this.kanCount++;
    this.flipNewDora();

    const rinshan = this.drawRinshan();
    if (rinshan) {
      player.tsumo = rinshan;
      this.phase = 'discard';
    }

    return true;
  }

  // --------------------------------------------------------
  // 大明槓 (Daiminkan) — 他家の捨て牌 + 手牌3枚
  // --------------------------------------------------------

  canDaiminkan(seat: number, tile: string): boolean {
    if (seat === this.currentActor) return false;
    const player = this.players[seat];
    if (player.riichi) return false;
    if (this.kanCount >= 4) return false;
    if (this.rinshanTiles.length === 0) return false;
    const count = player.hand.filter(t => tilesMatch(t, tile)).length;
    return count >= 3;
  }

  executeDaiminkan(seat: number, tile: string): boolean {
    if (!this.canDaiminkan(seat, tile)) return false;
    const player = this.players[seat];
    const fromSeat = this.lastDiscard!.seat;

    const meldTiles: string[] = [tile];
    let taken = 0;
    const newHand: string[] = [];
    for (const t of player.hand) {
      if (taken < 3 && tilesMatch(t, tile)) {
        meldTiles.push(t);
        taken++;
      } else {
        newHand.push(t);
      }
    }

    player.hand = newHand;
    player.melds.push({
      type: 'daiminkan',
      tiles: meldTiles,
      fromSeat,
      calledTile: tile,
    });

    const discards = this.players[fromSeat].discards;
    if (discards.length > 0 && discards[discards.length - 1] === tile) {
      discards.pop();
    }

    this.currentActor = seat;
    this.kanCount++;
    this.flipNewDora();

    const rinshan = this.drawRinshan();
    if (rinshan) {
      player.tsumo = rinshan;
      this.phase = 'discard';
    }

    this.firstTurnFlags[seat] = false;
    return true;
  }

  /** 大明槓可能なプレイヤー一覧 */
  getDaiminkanCandidates(discardedTile: string, discarderSeat: number): number[] {
    const candidates: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const seat = (discarderSeat + i) % 4;
      if (this.canDaiminkan(seat, discardedTile)) {
        candidates.push(seat);
      }
    }
    return candidates;
  }

  // --------------------------------------------------------
  // ツモ和了実行
  // --------------------------------------------------------
  executeTsumo(seat: number): WinResult | null {
    if (!this.canTsumo(seat)) return null;
    const player = this.players[seat];
    const result = this.calculateWin(seat, true, player.tsumo!);
    if (!result) return null;

    // 点数移動
    for (let i = 0; i < 4; i++) {
      this.players[i].score += result.scoreChanges[i];
    }

    this.handFinished = true;
    this.phase = 'finished';
    return result;
  }

  // --------------------------------------------------------
  // ロン和了実行
  // --------------------------------------------------------
  executeRon(seat: number): WinResult | null {
    if (!this.lastDiscard) return null;
    if (!this.canRon(seat, this.lastDiscard.tile)) return null;
    const result = this.calculateWin(seat, false, this.lastDiscard.tile);
    if (!result) return null;

    // 点数移動
    for (let i = 0; i < 4; i++) {
      this.players[i].score += result.scoreChanges[i];
    }

    this.handFinished = true;
    this.phase = 'finished';
    return result;
  }

  // --------------------------------------------------------
  // 九種九牌
  // --------------------------------------------------------
  canKyushukyuhai(seat: number): boolean {
    const player = this.players[seat];
    if (!this.firstTurnFlags[seat]) return false;
    if (!player.tsumo) return false;
    if (player.melds.length > 0) return false;
    // 他家の鳴きがあった場合は不可
    for (let i = 0; i < 4; i++) {
      if (i !== seat && this.players[i].melds.length > 0) return false;
    }
    return isKyushukyuhai(player.hand, player.tsumo);
  }

  // --------------------------------------------------------
  // 流局
  // --------------------------------------------------------
  isRyukyoku(): boolean {
    return this.wall.length === 0;
  }

  /** 流局処理 → HandResult */
  processRyukyoku(): HandResult {
    const tenpaiSeats: number[] = [];
    for (let i = 0; i < 4; i++) {
      if (this.isTenpai(i)) tenpaiSeats.push(i);
    }

    const scoreChanges: [number, number, number, number] = [0, 0, 0, 0];
    const numTenpai = tenpaiSeats.length;

    if (numTenpai > 0 && numTenpai < 4) {
      const totalPenalty = 3000;
      const tenpaiBonus = totalPenalty / numTenpai;
      const notenPenalty = totalPenalty / (4 - numTenpai);

      for (let i = 0; i < 4; i++) {
        if (tenpaiSeats.includes(i)) {
          scoreChanges[i] = tenpaiBonus;
        } else {
          scoreChanges[i] = -notenPenalty;
        }
      }

      // 点数適用
      for (let i = 0; i < 4; i++) {
        this.players[i].score += scoreChanges[i];
      }
    }

    const dealerRetains = tenpaiSeats.includes(this.dealerSeat);

    this.handFinished = true;
    this.phase = 'finished';

    return {
      type: 'ryukyoku',
      tenpaiSeats,
      scoreChanges,
      dealerRetains,
    };
  }

  // --------------------------------------------------------
  // 局の終了 → 次の局へ
  // --------------------------------------------------------
  advanceToNextHand(dealerRetains: boolean): boolean {
    // 本場更新
    if (dealerRetains) {
      this.honba++;
      // 親連荘: handNumber は変わらない
    } else {
      this.honba = 0;
      this.dealerSeat = (this.dealerSeat + 1) % 4;
      this.handNumber++;
    }

    // 和了時の供託はクリア（勝者が取得済み）
    // 流局時は供託は残る

    // トビ（飛び）チェック
    for (const p of this.players) {
      if (p.score < 0) {
        this.gameFinished = true;
        return false;
      }
    }

    // 東風戦: 東4局まで (handNumber >= 4 で終了)
    if (this.handNumber >= 4) {
      this.gameFinished = true;
      return false;
    }

    // 次の局を開始
    this.startNewHand();
    return true;
  }

  // --------------------------------------------------------
  // 合法手一覧（LLM用）
  // --------------------------------------------------------
  getDiscardCandidates(seat: number): string[] {
    const player = this.players[seat];
    const tiles = new Set<string>();
    player.hand.forEach(t => tiles.add(t));
    if (player.tsumo) tiles.add(player.tsumo);
    return Array.from(tiles);
  }

  /**
   * ヒューリスティック打牌選択（LLM不使用）
   * シャンテン数を最小化する牌を選択する。
   * 同シャンテンの場合は受入枚数が多い方を優先。
   */
  chooseBestDiscardHeuristic(seat: number): string {
    const player = this.players[seat];
    const allTiles = [...player.hand];
    if (player.tsumo) allTiles.push(player.tsumo);

    const candidates = this.getDiscardCandidates(seat);
    let bestTile = candidates[0];
    let bestShanten = 99;
    let bestUkeireCount = -1;

    for (const tile of candidates) {
      // この牌を切った後の手牌
      const remaining = [...allTiles];
      const idx = remaining.indexOf(tile);
      if (idx >= 0) remaining.splice(idx, 1);

      try {
        const kindIds = handToKindIds(remaining);
        const exposed = player.melds.map(m => meldToLibMentsu(m));
        const tehai = { closed: kindIds, exposed } as unknown as Tehai13;
        assertTehai13(tehai);
        const shanten = calculateShanten(tehai);

        if (shanten < bestShanten) {
          bestShanten = shanten;
          bestTile = tile;
          // 受入枚数も計算
          try {
            const ukeire = getUkeire(tehai);
            bestUkeireCount = ukeire.length;
          } catch {
            bestUkeireCount = 0;
          }
        } else if (shanten === bestShanten) {
          // 同シャンテンなら受入枚数で比較
          try {
            const ukeire = getUkeire(tehai);
            if (ukeire.length > bestUkeireCount) {
              bestUkeireCount = ukeire.length;
              bestTile = tile;
            }
          } catch { /* keep current best */ }
        }
      } catch {
        // パース失敗時はスキップ
      }
    }

    return bestTile;
  }

  /** ロン可能なプレイヤー一覧（頭ハネ順） */
  getRonCandidates(discardedTile: string, discarderSeat: number): number[] {
    const candidates: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const seat = (discarderSeat + i) % 4;
      if (this.canRon(seat, discardedTile)) {
        candidates.push(seat);
      }
    }
    return candidates;
  }

  /** ポン可能なプレイヤー一覧 */
  getPonCandidates(discardedTile: string, discarderSeat: number): number[] {
    const candidates: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const seat = (discarderSeat + i) % 4;
      if (this.canPon(seat, discardedTile)) {
        candidates.push(seat);
      }
    }
    return candidates;
  }
}

// ============================================================
// Part 5: 点数計算ヘルパー
// ============================================================

function getPaymentTotal(payment: Payment): number {
  if (payment.type === 'ron') return payment.amount;
  if (payment.type === 'koTsumo') return payment.amount[0] * 2 + payment.amount[1];
  if (payment.type === 'oyaTsumo') return payment.amount * 3;
  return 0;
}

/** 翻・符から点数を計算（簡易版） */
function calculatePaymentFromHanFu(han: number, fu: number, isDealer: boolean, isTsumo: boolean): number {
  let basePoints: number;

  if (han >= 13) basePoints = 8000;
  else if (han >= 11) basePoints = 6000;
  else if (han >= 8) basePoints = 4000;
  else if (han >= 6) basePoints = 3000;
  else if (han >= 5) basePoints = 2000;
  else {
    basePoints = fu * Math.pow(2, 2 + han);
    if (basePoints > 2000) basePoints = 2000; // 満貫切り上げ
  }

  if (isDealer) {
    if (isTsumo) {
      return Math.ceil(basePoints * 2 / 100) * 100 * 3;
    } else {
      return Math.ceil(basePoints * 6 / 100) * 100;
    }
  } else {
    if (isTsumo) {
      const childPay = Math.ceil(basePoints / 100) * 100;
      const dealerPay = Math.ceil(basePoints * 2 / 100) * 100;
      return childPay * 2 + dealerPay;
    } else {
      return Math.ceil(basePoints * 4 / 100) * 100;
    }
  }
}

function buildPayment(total: number, isDealer: boolean, isTsumo: boolean): Payment {
  if (!isTsumo) {
    return { type: 'ron' as const, amount: total };
  }
  if (isDealer) {
    return { type: 'oyaTsumo' as const, amount: Math.ceil(total / 3 / 100) * 100 };
  }
  const childPay = Math.ceil(total / 4 / 100) * 100;
  const dealerPay = Math.ceil(total / 2 / 100) * 100;
  return { type: 'koTsumo' as const, amount: [childPay, dealerPay] as readonly [number, number] };
}

// ============================================================
// Part 6: 表示ユーティリティ
// ============================================================

export function tileToEmoji(tile: string): string {
  const emojiMap: Record<string, string> = {
    '1m': '🀇', '2m': '🀈', '3m': '🀉', '4m': '🀊', '5m': '🀋',
    '6m': '🀌', '7m': '🀍', '8m': '🀎', '9m': '🀏', '0m': '🀋',
    '1p': '🀙', '2p': '🀚', '3p': '🀛', '4p': '🀜', '5p': '🀝',
    '6p': '🀞', '7p': '🀟', '8p': '🀠', '9p': '🀡', '0p': '🀝',
    '1s': '🀐', '2s': '🀑', '3s': '🀒', '4s': '🀓', '5s': '🀔',
    '6s': '🀕', '7s': '🀖', '8s': '🀗', '9s': '🀘', '0s': '🀔',
    '1z': '🀀', '2z': '🀁', '3z': '🀂', '4z': '🀃',
    '5z': '🀆', '6z': '🀅', '7z': '🀄',
  };
  return emojiMap[tile] || tile;
}

export function tileToName(tile: string): string {
  const suit = tile.slice(-1);
  const num = tile.slice(0, -1);
  const suitNames: Record<string, string> = { m: '萬', p: '筒', s: '索', z: '' };
  const honorNames: Record<string, string> = {
    '1': '東', '2': '南', '3': '西', '4': '北',
    '5': '白', '6': '發', '7': '中'
  };
  if (suit === 'z') return honorNames[num] || tile;
  return `${num === '0' ? '赤5' : num}${suitNames[suit]}`;
}

export { compareTiles, ALL_TILES };
