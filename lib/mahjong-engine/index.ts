/**
 * 麻雀エンジンラッパー
 * @pai-forge/riichi-mahjong をベースに、
 * 公開手牌ルール用にカスタマイズ
 */

// 牌の定義
export type TileSuit = 'm' | 'p' | 's' | 'z';
export type Tile = `${1|2|3|4|5|6|7|8|9}${TileSuit}` | `${1|2|3|4|5|6|7}z`;

// 全ての牌（136枚、赤ドラ含む）
export const ALL_TILES: string[] = [];
const suits: TileSuit[] = ['m', 'p', 's'];
const honors = ['1z', '2z', '3z', '4z', '5z', '6z', '7z']; // 東南西北白発中

// 数牌を生成
suits.forEach(suit => {
  for (let num = 1; num <= 9; num++) {
    // 通常牌は各4枚
    for (let i = 0; i < 4; i++) {
      // 5の牌は1枚を赤ドラにする（index 0）
      if (num === 5 && i === 0) {
        ALL_TILES.push(`0${suit}`); // 赤5
      } else {
        ALL_TILES.push(`${num}${suit}`);
      }
    }
  }
});

// 字牌を生成（各4枚）
honors.forEach(tile => {
  for (let i = 0; i < 4; i++) {
    ALL_TILES.push(tile);
  }
});

// 副露（鳴き）の型
export interface Meld {
  type: 'chi' | 'pon' | 'kan' | 'ankan';
  tiles: string[];
  fromSeat?: number; // 鳴き元
  calledTile?: string; // 鳴いた牌
}

// プレイヤーの手牌状態
export interface PlayerState {
  seat: number;
  hand: string[]; // 手牌（13枚）
  melds: Meld[]; // 副露
  discards: string[]; // 捨て牌
  riichi: boolean;
  riichiTurn?: number;
  score: number;
  tsumo?: string; // ツモ牌
}

// ゲーム状態
export interface GameState {
  round: string; // '東1局' etc
  honba: number;
  kyotaku: number; // 供託
  dealerSeat: number;
  currentTurn: number;
  currentActor: number;
  players: PlayerState[];
  wall: string[]; // 山
  doraIndicators: string[];
  uraDoraIndicators: string[];
  remainingTiles: number;
  isFinished: boolean;
  phase: 'draw' | 'discard' | 'call' | 'finished';
}

// アクションの型
export type ActionType = 
  | { type: 'draw' }
  | { type: 'discard'; tile: string }
  | { type: 'chi'; tiles: string[]; discard: string }
  | { type: 'pon'; tiles: string[]; discard: string }
  | { type: 'kan'; tiles: string[]; kanType: 'daiminkan' | 'kakan' | 'ankan' }
  | { type: 'riichi'; tile: string }
  | { type: 'tsumo' }
  | { type: 'ron' }
  | { type: 'pass' }
  | { type: 'kyushukyuhai' }; // 九種九牌

// 麻雀エンジンクラス
export class MahjongEngine {
  private state: GameState;
  
  constructor() {
    this.state = this.initGame();
  }

  // ゲーム初期化
  private initGame(): GameState {
    const shuffledTiles = this.shuffle([...ALL_TILES]);
    
    // 配牌
    const players: PlayerState[] = [];
    for (let i = 0; i < 4; i++) {
      const hand = shuffledTiles.splice(0, 13).sort(this.compareTiles);
      players.push({
        seat: i,
        hand,
        melds: [],
        discards: [],
        riichi: false,
        score: 25000,
      });
    }
    
    // 王牌（14枚）
    const deadWall = shuffledTiles.splice(0, 14);
    const doraIndicators = [deadWall[0]];
    
    return {
      round: '東1局',
      honba: 0,
      kyotaku: 0,
      dealerSeat: 0,
      currentTurn: 0,
      currentActor: 0,
      players,
      wall: shuffledTiles,
      doraIndicators,
      uraDoraIndicators: [deadWall[5]],
      remainingTiles: shuffledTiles.length,
      isFinished: false,
      phase: 'draw',
    };
  }

  // 牌の比較関数（ソート用）
  private compareTiles(a: string, b: string): number {
    const suitOrder: Record<string, number> = { m: 0, p: 1, s: 2, z: 3 };
    const suitA = a.slice(-1);
    const suitB = b.slice(-1);
    const numA = parseInt(a.slice(0, -1)) || 0;
    const numB = parseInt(b.slice(0, -1)) || 0;
    
    if (suitA !== suitB) {
      return suitOrder[suitA] - suitOrder[suitB];
    }
    return numA - numB;
  }

  // 配列シャッフル
  private shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // 現在の状態を取得
  getState(): GameState {
    return JSON.parse(JSON.stringify(this.state));
  }

  // ツモ
  draw(): string | null {
    if (this.state.wall.length === 0) {
      return null;
    }
    const tile = this.state.wall.shift()!;
    this.state.players[this.state.currentActor].tsumo = tile;
    this.state.remainingTiles = this.state.wall.length;
    this.state.phase = 'discard';
    return tile;
  }

  // 打牌
  discard(tile: string): boolean {
    const player = this.state.players[this.state.currentActor];
    
    // ツモ牌を捨てる場合
    if (player.tsumo === tile) {
      player.discards.push(tile);
      player.tsumo = undefined;
    } else {
      // 手牌から捨てる場合
      const idx = player.hand.indexOf(tile);
      if (idx === -1) return false;
      
      if (player.tsumo) {
        player.hand.push(player.tsumo);
        player.tsumo = undefined;
      }
      player.hand.splice(idx, 1);
      player.hand.sort(this.compareTiles);
      player.discards.push(tile);
    }
    
    this.state.phase = 'call';
    return true;
  }

  // 鳴き判定後、次のプレイヤーへ
  nextTurn(): void {
    this.state.currentActor = (this.state.currentActor + 1) % 4;
    this.state.currentTurn++;
    this.state.phase = 'draw';
  }

  // 合法手を取得
  getLegalActions(seat: number): ActionType[] {
    const actions: ActionType[] = [];
    const player = this.state.players[seat];
    
    if (this.state.phase === 'draw' && seat === this.state.currentActor) {
      actions.push({ type: 'draw' });
    }
    
    if (this.state.phase === 'discard' && seat === this.state.currentActor) {
      // 打牌可能な牌
      const tiles = new Set<string>();
      player.hand.forEach(t => tiles.add(t));
      if (player.tsumo) tiles.add(player.tsumo);
      
      tiles.forEach(tile => {
        actions.push({ type: 'discard', tile });
      });
      
      // リーチ判定（簡易）
      if (!player.riichi && player.melds.length === 0 && this.canRiichi(seat)) {
        tiles.forEach(tile => {
          actions.push({ type: 'riichi', tile });
        });
      }
      
      // ツモ和了判定
      if (this.canTsumo(seat)) {
        actions.push({ type: 'tsumo' });
      }
    }
    
    if (this.state.phase === 'call' && seat !== this.state.currentActor) {
      const lastDiscard = this.getLastDiscard();
      if (lastDiscard) {
        // ポン判定
        if (this.canPon(seat, lastDiscard)) {
          actions.push({ type: 'pon', tiles: [lastDiscard, lastDiscard, lastDiscard], discard: '' });
        }
        // チー判定（上家からのみ）
        if ((this.state.currentActor + 1) % 4 === seat) {
          const chiOptions = this.getChiOptions(seat, lastDiscard);
          chiOptions.forEach(tiles => {
            actions.push({ type: 'chi', tiles, discard: '' });
          });
        }
        // ロン判定
        if (this.canRon(seat, lastDiscard)) {
          actions.push({ type: 'ron' });
        }
      }
      actions.push({ type: 'pass' });
    }
    
    return actions;
  }

  // 最後の捨て牌を取得
  getLastDiscard(): string | null {
    const discards = this.state.players[this.state.currentActor].discards;
    return discards.length > 0 ? discards[discards.length - 1] : null;
  }

  // ポン可能判定
  private canPon(seat: number, tile: string): boolean {
    const hand = this.state.players[seat].hand;
    const count = hand.filter(t => this.tilesMatch(t, tile)).length;
    return count >= 2;
  }

  // チー可能なパターン取得
  private getChiOptions(seat: number, tile: string): string[][] {
    const options: string[][] = [];
    const suit = tile.slice(-1);
    if (suit === 'z') return options; // 字牌はチー不可
    
    const num = parseInt(tile.slice(0, -1));
    const hand = this.state.players[seat].hand;
    
    // 順子の3パターンをチェック
    const patterns = [
      [num - 2, num - 1], // tile が右端
      [num - 1, num + 1], // tile が中央
      [num + 1, num + 2], // tile が左端
    ];
    
    patterns.forEach(([a, b]) => {
      if (a >= 1 && a <= 9 && b >= 1 && b <= 9) {
        const tileA = `${a}${suit}`;
        const tileB = `${b}${suit}`;
        if (hand.some(t => this.tilesMatch(t, tileA)) && 
            hand.some(t => this.tilesMatch(t, tileB))) {
          options.push([tileA, tile, tileB].sort(this.compareTiles));
        }
      }
    });
    
    return options;
  }

  // 牌の一致判定（赤ドラ考慮）
  private tilesMatch(a: string, b: string): boolean {
    const normA = a.startsWith('0') ? '5' + a.slice(-1) : a;
    const normB = b.startsWith('0') ? '5' + b.slice(-1) : b;
    return normA === normB;
  }

  // リーチ可能判定（簡易版）
  private canRiichi(seat: number): boolean {
    const player = this.state.players[seat];
    if (player.riichi || player.melds.length > 0 || player.score < 1000) {
      return false;
    }
    // TODO: 聴牌判定
    return this.state.remainingTiles >= 4;
  }

  // ツモ和了判定（簡易版）
  private canTsumo(seat: number): boolean {
    // TODO: 和了判定実装
    return false;
  }

  // ロン和了判定（簡易版）
  private canRon(seat: number, tile: string): boolean {
    // TODO: 和了判定実装
    return false;
  }

  // アクション実行
  applyAction(seat: number, action: ActionType): boolean {
    switch (action.type) {
      case 'draw':
        return this.draw() !== null;
      case 'discard':
        return this.discard(action.tile);
      case 'pass':
        return true;
      // TODO: 他のアクション実装
      default:
        return false;
    }
  }

  // 流局判定
  isRyukyoku(): boolean {
    return this.state.remainingTiles === 0;
  }

  // ゲーム終了判定
  isGameOver(): boolean {
    return this.state.isFinished;
  }
}

// ユーティリティ関数
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
  const suitNames: Record<string, string> = {
    m: '萬', p: '筒', s: '索', z: ''
  };
  const honorNames: Record<string, string> = {
    '1': '東', '2': '南', '3': '西', '4': '北',
    '5': '白', '6': '發', '7': '中'
  };
  
  if (suit === 'z') {
    return honorNames[num] || tile;
  }
  return `${num === '0' ? '赤5' : num}${suitNames[suit]}`;
}
