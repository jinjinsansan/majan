# 麻雀AI Twin 観戦アプリ — 開発仕様書 v1.0
> Claude Code（ターミナル開発）向け。そのままプロジェクト開始できる構成。

---

## 1. プロダクト概要

ユーザーが入力したプロンプト（性格・打ち筋・好きな役）から **Twin AI**（AIキャラクター）を生成し、Twin同士4人がサーバー上で自動対局する。対局はブラウザで観戦でき、各AIの**思考ログ（短文＋重要局面の詳細）**をリアルタイムまたは再生形式で読める。

### コンセプト
- 競技よりも「読み物・観戦・思考の面白さ」を優先
- 公開手牌ルール（全員の手牌が常時見える完全情報対局）
- AIの思考が文章で読める → Mリーグ風の解説体験

---

## 2. 技術スタック（確定）

| 役割 | 技術 |
|------|------|
| フロントエンド | Next.js 14（App Router）/ Vercel |
| データベース・認証 | Supabase（Postgres + Auth + Realtime） |
| メール送信 | Resend（認証メール・パスワードリセット） |
| 非同期対局エンジン | Cloudflare Workers + Queues |
| LLM（思考生成） | OpenAI GPT-4o-mini or Anthropic Claude API |
| 麻雀ゲームエンジン | 既存ライブラリ利用（自作しない）|

### 麻雀エンジン候補
```
- mahjong-utils（npm）
- riichi-mahjong（npm）
- または Python側で tenhou-log-parser 等 → Worker経由
```
> ルール合法性・点計算・アガリ判定はエンジンが唯一正とする。LLMは候補手から選ぶだけ。

---

## 3. ルール仕様（固定・変更不可）

| 項目 | 設定 |
|------|------|
| 人数 | 4人麻雀のみ |
| 形式 | 東風戦（MVPは東風固定） |
| 赤ドラ | あり（赤3：萬子・索子・筒子各1枚） |
| 喰いタン | あり |
| 後付け | あり |
| ダブロン | なし（頭ハネ） |
| 供託・本場 | あり |
| トビ | あり（終了条件） |
| 途中流局 | 九種九牌のみ |
| ウマ/オカ | なし（MVP） |
| 公開手牌 | **全員常時表示**（完全情報ルール） |

> 対局画面・ルーム作成画面に必ず表示：「この対局は公開手牌ルールです。全員の手牌が常に表示されます。」

---

## 4. データベース設計（Supabase）

### テーブル定義

```sql
-- ユーザー（Supabase Auth に寄せる）
-- auth.users を使用。追加情報は profiles テーブルに。

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Twin（AIキャラクター）
CREATE TABLE twins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  persona_prompt TEXT NOT NULL,       -- LLMに渡すキャラ定義文
  style_params JSONB DEFAULT '{}',    -- 攻撃度/守備度/鳴き積極度 etc.
  is_public BOOLEAN DEFAULT false,
  is_npc BOOLEAN DEFAULT false,       -- 運営が用意したNPC
  npc_type TEXT,                      -- 'speed' | 'power' | 'defense'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ゲーム（対局）
CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users(id),
  mode TEXT NOT NULL,                 -- 'ai_only' | 'online'
  status TEXT DEFAULT 'queued',       -- queued | matching | running | finished | failed
  rule_set JSONB DEFAULT '{}',        -- 固定ルール情報（記録用）
  player_twin_ids UUID[4],            -- 席順[0]=東 [1]=南 [2]=西 [3]=北
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

-- 局（Hand）
CREATE TABLE hands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id),
  hand_no INTEGER NOT NULL,           -- 通し番号 1〜
  round TEXT NOT NULL,                -- '東1局' etc.
  honba INTEGER DEFAULT 0,
  kyotaku INTEGER DEFAULT 0,
  dealer_seat INTEGER NOT NULL,       -- 0〜3
  result_json JSONB,                  -- 和了/流局の結果
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- アクション（1手ごと）
CREATE TABLE actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id),
  hand_id UUID REFERENCES hands(id),
  seq_no INTEGER NOT NULL,            -- 対局内通し連番
  actor_seat INTEGER NOT NULL,        -- 0〜3
  action_type TEXT NOT NULL,
  -- 'draw' | 'discard' | 'chi' | 'pon' | 'kan' | 'riichi' | 'tsumo' | 'ron' | 'ryukyoku'
  payload_json JSONB DEFAULT '{}',    -- 牌情報など
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 思考ログ
CREATE TABLE reasoning_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID REFERENCES actions(id),
  summary_text TEXT NOT NULL,         -- 短文（50〜120文字）
  detail_text TEXT,                   -- 詳細（重要局面のみ）
  structured_json JSONB DEFAULT '{}', -- 候補・危険度・モードなど
  tokens_used INTEGER,
  model_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- オンライン対戦の席状態
CREATE TABLE game_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id),
  seat INTEGER NOT NULL,              -- 0〜3
  twin_id UUID REFERENCES twins(id),
  user_id UUID REFERENCES auth.users(id), -- NULL = NPC or AI only
  seat_status TEXT DEFAULT 'connected',
  -- 'connected' | 'disconnected_grace' | 'replaced_by_npc' | 'spectating'
  disconnected_at TIMESTAMPTZ,
  last_heartbeat TIMESTAMPTZ DEFAULT NOW()
);
```

### RLS（Row Level Security）方針

```sql
-- twins: 自分のものはCRUD可、is_public=trueは誰でもread
-- games: 参加TwinのオーナーはREAD可、is_public_gameなら誰でもREAD
-- hands / actions / reasoning_logs: 対応gameのREADに準じる
-- game_seats: gameのREADに準じる
```

---

## 5. structured_json 仕様（reasoning_logs）

```json
{
  "candidates": [
    { "tile": "1m", "reason_short": "安全牌、打点には影響なし" },
    { "tile": "9p", "reason_short": "孤立牌、現物" },
    { "tile": "7z", "reason_short": "字牌処理でスピードアップ" }
  ],
  "risk": "medium",          // "low" | "medium" | "high"
  "mode": "push",            // "push" | "pull" | "balance"
  "target_yaku": ["tanyao", "pinfu"],
  "key_tiles": ["3m", "6m"], // 危険牌・待ち牌など
  "is_riichi_decision": false,
  "is_naki_decision": false,
  "is_oshihiki": false       // 押し引き判断フラグ
}
```

---

## 6. API設計（Next.js Route Handlers）

### 認証
```
POST /api/auth/signup
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/reset-password
```

### Twin
```
GET  /api/twins              -- 自分のTwin一覧
GET  /api/twins/public       -- 公開Twin一覧
POST /api/twins              -- Twin作成
GET  /api/twins/:id
PATCH /api/twins/:id
DELETE /api/twins/:id
```

### ゲーム
```
POST /api/games              -- 対局作成（Queueへ投入）
GET  /api/games              -- 自分が参加した対局一覧
GET  /api/games/:id          -- 対局概要
GET  /api/games/:id/hands    -- 局一覧
GET  /api/games/:id/actions?cursor=  -- アクションログ（ページネーション）
GET  /api/games/:id/reasoning?cursor= -- 思考ログ
```

### オンライン（WebSocket/Realtime）
```
Supabase Realtime でチャンネル購読
channel: game:{game_id}
events: action_added | hand_result | game_finished | seat_status_changed
```

---

## 7. Cloudflare Worker（対局進行エンジン）

### フロー
```
1. POST /api/games → Supabaseにgame作成 → Cloudflare Queueにメッセージ投入
2. Queue Consumer（Worker）が起動
3. Workerが麻雀エンジンを使って対局を進行
4. 各アクションをactions テーブルに書き込み
5. 重要局面でLLMを呼び出してreasoning_logsに書き込み
6. フロントはSupabase Realtimeで受信（またはポーリング）
```

### Worker 擬似コード
```typescript
// worker/game-engine.ts
export default {
  async queue(batch: MessageBatch, env: Env) {
    for (const msg of batch.messages) {
      const { game_id } = msg.body;
      await runGame(game_id, env);
      msg.ack();
    }
  }
}

async function runGame(gameId: string, env: Env) {
  const game = await getGame(gameId, env);
  const engine = new MahjongEngine(game.rule_set);
  
  while (!engine.isFinished()) {
    const state = engine.getState();
    const actor = state.currentActor;
    const candidates = engine.getLegalMoves(actor);
    
    // LLMに候補手を渡して選択させる
    const { chosen, reasoning } = await llmDecide(
      actor.twin, state, candidates, env
    );
    
    // エンジンに適用（不正手は例外 → ルールベースで補正）
    engine.applyAction(chosen);
    
    // DBに書き込み
    await saveAction(gameId, chosen, env);
    await saveReasoning(chosen.id, reasoning, env);
  }
  
  await finalizeGame(gameId, engine.getResult(), env);
}
```

### LLM呼び出し仕様
```typescript
// LLMに渡す入力
{
  system: `${twin.persona_prompt}\n\n必ず候補手の中から選択すること。JSON形式で返答。`,
  user: `
    現在の手牌: ${JSON.stringify(myHand)}
    全プレイヤー手牌: ${JSON.stringify(allHands)}  // 公開手牌ルール
    捨て牌: ${JSON.stringify(discards)}
    候補手: ${JSON.stringify(candidates)}  // エンジンが列挙した合法手のみ
    
    以下のJSON形式で返答:
    {
      "chosen": "切る牌or行動",
      "summary": "50〜120文字の短文理由",
      "detail": "詳細（重要局面のみ、それ以外はnull）",
      "candidates_analysis": [...],
      "risk": "low|medium|high",
      "mode": "push|pull|balance"
    }
  `
}
```

### LLMコスト制御
- 毎手：short summary のみ（GPT-4o-mini推奨）
- 重要局面のみ：詳細生成（リーチ/鳴き/テンパイ/押し引き/和了）
- 失敗時：定型フォールバック（エラーにしない）
- 1対局あたりのLLM呼び出し上限：Workerで管理

---

## 8. ディレクトリ構成（推奨）

```
/
├── app/                        # Next.js App Router
│   ├── (auth)/
│   │   ├── login/
│   │   └── signup/
│   ├── dashboard/              # ダッシュボード
│   ├── twins/
│   │   ├── new/               # Twin作成
│   │   └── [id]/edit/         # Twin編集
│   ├── games/
│   │   ├── new/               # 対局作成
│   │   └── [id]/              # 観戦画面
│   └── api/                   # Route Handlers
│       ├── twins/
│       ├── games/
│       └── auth/
├── components/
│   ├── mahjong/
│   │   ├── MahjongTable.tsx   # 卓ビュー（メイン）
│   │   ├── PlayerSeat.tsx     # 各席（手牌・捨て牌・副露）
│   │   ├── HandTiles.tsx      # 手牌表示
│   │   ├── DiscardPile.tsx    # 捨て牌
│   │   ├── MeldTiles.tsx      # 副露（鳴き牌）
│   │   ├── GameOverlay.tsx    # 和了/流局演出
│   │   └── PlaybackControls.tsx # 再生コントロール
│   ├── reasoning/
│   │   ├── ReasoningPanel.tsx # 思考ログパネル
│   │   ├── SummaryLog.tsx     # 短文ログ
│   │   └── DetailLog.tsx      # 詳細ログ（折りたたみ）
│   └── ui/                    # shadcn/ui等の共通コンポーネント
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   └── server.ts
│   ├── mahjong-engine/        # エンジンラッパー
│   └── llm/                   # LLM呼び出しユーティリティ
├── workers/                   # Cloudflare Workers
│   ├── game-engine/
│   │   ├── index.ts
│   │   ├── engine.ts
│   │   └── llm-decide.ts
│   └── wrangler.toml
└── supabase/
    ├── migrations/            # SQLマイグレーション
    └── seed.sql               # NPCデータ等
```

---

## 9. 画面仕様

### 9-1. 観戦画面（/games/[id]）— 最重要

```
┌─────────────────────────────────────────────────┐
│ ヘッダー: 東1局 / 本場0 / 供託0                  │
│ 東:仁Twin 25000点 / 南:攻撃型NPC 25000点 ...     │
├────────────────────────┬────────────────────────┤
│                        │ 思考ログパネル          │
│      卓ビュー(2D)       │                        │
│  [北席の手牌・捨て牌]   │ ▶ 仁Twin              │
│                        │ 「タンヤオ狙い。安牌を   │
│  [西]捨牌  中央  [東]捨牌 │  処理してスピードアップ」│
│                        │                        │
│  [南席の手牌・捨て牌]   │ ▼ 詳細（重要局面）     │
│                        │   候補A: 1m / B: 9p    │
│                        │   危険度: 低 / 押し     │
├────────────────────────┴────────────────────────┤
│ ▶ ⏸ 1x 2x 4x 8x | ◀1手 1手▶ | 局ジャンプ▼     │
│ タイムライン（直近30手）                          │
└─────────────────────────────────────────────────┘
```

**カードコンポーネントの演出（軽量）**

| イベント | 演出 |
|---------|------|
| 打牌 | 捨て牌にフェードイン（200ms） |
| ツモ | 中央「ツモ」テキスト（500ms） |
| ポン/チー/カン | 中央テキスト＋副露牌追加（700ms） |
| リーチ | リーチ棒アイコン＋リーチ牌強調枠 |
| ロン/ツモ和了 | 中央オーバーレイ: 役名・翻符・点数（2秒） |
| 流局 | 中央オーバーレイ: 流局・テンパイ情報（2秒） |

**再生コントロール仕様**

- ▶/⏸：再生/停止
- 速度：1x / 2x / 4x / 8x
- ◀1手：1アクション戻し
- 1手▶：1アクション送り
- 局ジャンプ：東1〜東4（東風）の局頭へ直行
- 重要局面ジャンプ：リーチ/鳴き/和了 発生点へジャンプ

### 9-2. Twin作成画面（/twins/new）

**入力フォーム**
```
- Twin名（必須）
- 性格タグ（複数選択）: 攻撃的 / 慎重 / 理詰め / 感情派 / バランス型
- 打ち筋（単一選択）: スピード重視 / 打点重視 / バランス / 守備 / 押し
- 好きな役（複数選択）: タンヤオ / ピンフ / 三色 / 一盃口 / 混一色 / 清一色 / リーチ / etc.
- リーチ判断: 早い / 遅い / 状況依存
- 鳴き判断: 多い / 少ない / 状況依存
- 自由プロンプト（必須、500〜3000文字）
- 公開設定: 公開 / 非公開
```

**保存処理**
1. フォーム入力 → `persona_prompt`（LLM用テキスト）を生成
2. `style_params`（数値パラメータJSON）を算出して保存
3. 「Twinのキャラ説明プレビュー」を表示

### 9-3. 対局作成画面（/games/new）

```
- 参加Twin選択（4席分）
  - 自分のTwin（必須で1席）
  - 他の公開Twin or 運営NPC（残り3席）
- モード選択: AI対局のみ / オンライン対戦（MVP後半）
- 対局開始ボタン
- 注意書き（固定表示）:
  「この対局は公開手牌ルールです。全員の手牌が常に表示されます。」
```

---

## 10. オンライン対戦 & ブラウザ離脱仕様

### AIのみ対局（ai_only）

```
対局開始 → CloudflareQueueに投入 → Worker が完全自動進行
ブラウザを閉じても対局は継続
再訪問時:
  - 「続きから観戦」= Realtimeで最新に追いつく
  - 「最初から再生」= seq_no=1から再生
```

### オンライン対戦（online）

```
マッチング:
  - ルーム作成 → 60秒待機
  - 揃わなければ不足席をNPCで埋めて開始

切断検知:
  - heartbeat: 5秒間隔、15秒無応答で切断扱い

状態遷移:
  connected → disconnected_grace（猶予90秒）→ replaced_by_npc

猶予中:
  - 他プレイヤーに「◯◯離席中」表示
  - 離席中はNPCが代打ち

復帰時（MVP）:
  - seat_statusを'spectating'に更新
  - 観戦者として続きを見られる（席は戻さない）
```

---

## 11. NPC（運営Twin）仕様

Supabase の `twins` テーブルに `is_npc=true` で登録。

| NPC名 | タイプ | 特徴 |
|-------|--------|------|
| スピード太郎 | speed | 鳴き多め・早上がり重視 |
| 打点一郎 | power | 門前高打点・リーチ重視 |
| 守備花子 | defense | 放銃回避・オリ重視 |

---

## 12. 思考ログ生成ルール

### 短文（毎手・必須）

```
生成: 毎アクション
文字数: 50〜120文字
内容: いまの狙い + 危険度 + 切る理由
モデル: GPT-4o-mini（コスト優先）
フォールバック: "手牌を整理する。" などの定型文
```

### 詳細（重要局面のみ）

```
トリガー条件（AND/OR）:
  - リーチ判断（打牌前）
  - 鳴き判断（チー/ポン/カン選択時）
  - テンパイ到達（その局初回）
  - 終盤の押し引き（残りツモ3以下 & 他家リーチ中）
  - 和了/放銃（局のまとめ）

文字数: 200〜400文字
フォーマット:
  狙い: ◯◯
  候補: A=◯◯ / B=◯◯ / C=◯◯
  危険度: 低/中/高（理由1行）
  決定: ◯◯（理由1行）
```

### UI連動（候補ハイライト）

```
思考ログの「候補A」をクリック/タップ
  → 卓上の対応する牌にハイライト枠が出る
  → 「この牌を選ぶ理由」の箇所へスクロール
```

---

## 13. MVP受入条件（Definition of Done）

| # | 条件 | 検証方法 |
|---|------|----------|
| 1 | 会員登録→Twin作成→対局作成→AI4人が最後まで打ち切る | E2Eテスト |
| 2 | ルール違反（不正打牌・不正鳴き）が起きない | エンジン単体テスト |
| 3 | 観戦画面で倍速再生・局ジャンプが機能する | 手動テスト |
| 4 | 毎手に短文思考ログが表示される | 対局ログ確認 |
| 5 | 重要局面（リーチ等）で詳細ログが展開できる | 手動テスト |
| 6 | ブラウザを閉じて再訪問しても対局が継続している | 手動テスト |
| 7 | 公開Twinを他ユーザーが対局に招待できる | 手動テスト |
| 8 | 公開手牌ルールの注意書きが必要箇所に表示されている | 目視確認 |

---

## 14. 拡張（MVP後）

優先度順:

1. **リアルタイム観戦**（Supabase Realtime完全活用）
2. **半荘対応**
3. **Twinマーケット**（人気ランキング・対戦招待）
4. **Twin成長**（対局ログからの打ち筋分析）
5. **ウマ/オカ設定**
6. **切断後の席返し復帰**（オンライン対戦）

---

## 15. 環境変数（.env.local）

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

RESEND_API_KEY=

CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_QUEUE_ID=
CLOUDFLARE_API_TOKEN=

OPENAI_API_KEY=
# or
ANTHROPIC_API_KEY=
```

---

## 16. 開発フェーズ（推奨順序）

```
Phase 0: 土台
  - Next.js + Supabase + Resend セットアップ
  - 認証（サインアップ・ログイン・メール認証）
  - Twin CRUD

Phase 1: AIのみ対局（コア）
  - 麻雀エンジン統合（合法手生成・点計算）
  - Cloudflare Worker + Queue セットアップ
  - AI意思決定（LLM呼び出し・候補手選択）
  - actions / reasoning_logs DB保存
  - 観戦画面（卓2D + 手牌 + 再生コントロール）
  - 思考ログ表示（短文 + 詳細折りたたみ）

Phase 2: 再開・NPC
  - "続きから観戦" / "最初から再生"
  - NPC 3タイプ登録
  - 公開Twin機能

Phase 3: オンライン対戦
  - マッチング（待機→NPC補完）
  - Supabase Realtime同期
  - heartbeat + 切断猶予 + NPC代打ち
  - 復帰（観戦復帰）
```

---

*仕様書 v1.0 — Claude Code 開発用*
