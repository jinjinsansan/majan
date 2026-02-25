// Twin (AI Character)
export interface Twin {
  id: string;
  user_id: string;
  name: string;
  persona_prompt: string;
  style_params: StyleParams;
  is_public: boolean;
  is_npc: boolean;
  npc_type?: 'speed' | 'power' | 'defense';
  created_at: string;
}

export interface StyleParams {
  aggression?: number;      // 攻撃度 0-100
  defense?: number;         // 守備度 0-100
  naki_tendency?: number;   // 鳴き積極度 0-100
  riichi_speed?: 'early' | 'late' | 'situational';
}

// Game (対局)
export type GameMode = 'ai_only' | 'online';
export type GameStatus = 'queued' | 'matching' | 'running' | 'finished' | 'failed';

export interface Game {
  id: string;
  created_by: string;
  mode: GameMode;
  status: GameStatus;
  rule_set: RuleSet;
  player_twin_ids: [string, string, string, string]; // 東南西北
  created_at: string;
  started_at?: string;
  finished_at?: string;
}

export interface RuleSet {
  players: 4;
  format: 'tonpu';        // 東風戦
  aka_dora: boolean;      // 赤ドラ
  kuitan: boolean;        // 喰いタン
  atozuke: boolean;       // 後付け
  double_ron: false;      // 頭ハネ
  tobi: boolean;          // トビ終了
  途中流局: 'kyushu';     // 九種九牌のみ
  open_hand: true;        // 公開手牌
}

// Hand (局)
export interface Hand {
  id: string;
  game_id: string;
  hand_no: number;
  round: string;          // '東1局' etc.
  honba: number;
  kyotaku: number;
  dealer_seat: 0 | 1 | 2 | 3;
  result_json?: HandResult;
  created_at: string;
}

export interface HandResult {
  type: 'agari' | 'ryukyoku';
  winner_seat?: number;
  loser_seat?: number;
  yaku?: string[];
  han?: number;
  fu?: number;
  score_changes: [number, number, number, number];
}

// Action (1手ごと)
export type ActionType = 
  | 'draw' 
  | 'discard' 
  | 'chi' 
  | 'pon' 
  | 'kan' 
  | 'riichi' 
  | 'tsumo' 
  | 'ron' 
  | 'ryukyoku';

export interface Action {
  id: string;
  game_id: string;
  hand_id: string;
  seq_no: number;
  actor_seat: 0 | 1 | 2 | 3;
  action_type: ActionType;
  payload_json: ActionPayload;
  created_at: string;
}

export interface ActionPayload {
  tile?: string;          // 牌 (e.g., '1m', '9p', '7z')
  tiles?: string[];       // 複数牌 (鳴き用)
  from_seat?: number;     // 鳴き元
  riichi_tile?: string;   // リーチ宣言牌
}

// Reasoning Log (思考ログ)
export interface ReasoningLog {
  id: string;
  action_id: string;
  summary_text: string;           // 短文（50〜120文字）
  detail_text?: string;           // 詳細（重要局面のみ）
  structured_json: StructuredReasoning;
  tokens_used?: number;
  model_name?: string;
  created_at: string;
}

export interface StructuredReasoning {
  candidates: CandidateAnalysis[];
  risk: 'low' | 'medium' | 'high';
  mode: 'push' | 'pull' | 'balance';
  target_yaku?: string[];
  key_tiles?: string[];
  is_riichi_decision?: boolean;
  is_naki_decision?: boolean;
  is_oshihiki?: boolean;
}

export interface CandidateAnalysis {
  tile: string;
  reason_short: string;
}

// Game Seat (オンライン対戦用)
export type SeatStatus = 
  | 'connected' 
  | 'disconnected_grace' 
  | 'replaced_by_npc' 
  | 'spectating';

export interface GameSeat {
  id: string;
  game_id: string;
  seat: 0 | 1 | 2 | 3;
  twin_id: string;
  user_id?: string;
  seat_status: SeatStatus;
  disconnected_at?: string;
  last_heartbeat: string;
}

// Profile
export interface Profile {
  id: string;
  display_name: string;
  avatar_url?: string;
  created_at: string;
}

// Mahjong Tiles
export type TileSuit = 'm' | 'p' | 's' | 'z'; // 萬子, 筒子, 索子, 字牌
export type TileNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

// Game State (for engine)
export interface GameState {
  hands: PlayerHand[];
  discards: string[][];       // 4人分の捨て牌
  melds: Meld[][];            // 4人分の副露
  dora_indicators: string[];
  current_actor: 0 | 1 | 2 | 3;
  remaining_tiles: number;
  scores: [number, number, number, number];
  riichi_sticks: [boolean, boolean, boolean, boolean];
}

export interface PlayerHand {
  tiles: string[];
  tsumo?: string;             // ツモ牌
}

export interface Meld {
  type: 'chi' | 'pon' | 'kan' | 'ankan';
  tiles: string[];
  from_seat?: number;
}
