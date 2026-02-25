/**
 * LLM統合モジュール
 * Twin（AIキャラクター）の意思決定を担当
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { Twin, GameState, ActionType, StructuredReasoning } from '@/lib/types';

// LLMレスポンスの型
export interface LLMDecision {
  chosen: string; // 選択したアクション
  summary: string; // 短文理由（50-120文字）
  detail: string | null; // 詳細（重要局面のみ）
  structured: StructuredReasoning;
  tokensUsed: number;
  model: string;
}

// 重要局面かどうか判定
export function isKeyMoment(
  state: any,
  action: string,
  candidates: string[]
): boolean {
  // リーチ判断
  if (action.includes('riichi')) return true;
  
  // 鳴き判断
  if (action.includes('chi') || action.includes('pon') || action.includes('kan')) return true;
  
  // 和了
  if (action.includes('tsumo') || action.includes('ron')) return true;
  
  // 終盤（残り4巡以内）で他家リーチ中
  if (state.remainingTiles <= 16) {
    const anyRiichi = state.players?.some((p: any) => p.riichi && p.seat !== state.currentActor);
    if (anyRiichi) return true;
  }
  
  return false;
}

// OpenAI/Anthropic共通のプロンプト生成
export function buildPrompt(
  twin: Twin,
  state: any,
  candidates: string[],
  allHands: any[]
): { system: string; user: string } {
  const system = `${twin.persona_prompt}

【重要なルール】
1. 必ず「candidates」の中から選択すること（それ以外の選択は無効）
2. 公開手牌ルール: 全員の手牌が見えている状態で判断すること
3. JSON形式で返答すること`;

  const user = `現在の局面:
- ラウンド: ${state.round}
- 残りツモ: ${state.remainingTiles}
- ドラ表示: ${state.doraIndicators?.join(', ')}

【全プレイヤーの手牌】（公開手牌ルール）
${allHands.map((h, i) => `${i === state.currentActor ? '→' : '  '} ${i}番席: ${h.hand.join(' ')} ${h.tsumo ? `[ツモ: ${h.tsumo}]` : ''} ${h.riichi ? '【リーチ】' : ''}`).join('\n')}

【候補手】
${candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}

以下のJSON形式で返答してください:
{
  "chosen": "選択した候補（候補手の文字列をそのまま）",
  "summary": "50〜120文字の短文理由",
  "detail": "詳細説明（重要局面の場合のみ、それ以外はnull）",
  "risk": "low|medium|high",
  "mode": "push|pull|balance",
  "target_yaku": ["狙っている役"],
  "key_tiles": ["注目すべき危険牌・待ち牌"],
  "is_oshihiki": false
}`;

  return { system, user };
}

// OpenAI APIで決定
export async function decideWithOpenAI(
  twin: Twin,
  state: any,
  candidates: string[],
  allHands: any[]
): Promise<LLMDecision> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const { system, user } = buildPrompt(twin, state, candidates, allHands);
  const isKey = isKeyMoment(state, candidates[0], candidates);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      max_tokens: isKey ? 500 : 200,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    
    return {
      chosen: parsed.chosen || candidates[0],
      summary: parsed.summary || '状況を見て判断。',
      detail: isKey ? parsed.detail : null,
      structured: {
        candidates: candidates.map(c => ({ tile: c, reason_short: '' })),
        risk: parsed.risk || 'medium',
        mode: parsed.mode || 'balance',
        target_yaku: parsed.target_yaku || [],
        key_tiles: parsed.key_tiles || [],
        is_riichi_decision: candidates.some(c => c.includes('リーチ')),
        is_oshihiki: parsed.is_oshihiki || false,
      },
      tokensUsed: response.usage?.total_tokens || 0,
      model: 'gpt-4o-mini',
    };
  } catch (error) {
    console.error('OpenAI API error:', error);
    return fallbackDecision(candidates);
  }
}

// Anthropic APIで決定
export async function decideWithAnthropic(
  twin: Twin,
  state: any,
  candidates: string[],
  allHands: any[]
): Promise<LLMDecision> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const { system, user } = buildPrompt(twin, state, candidates, allHands);
  const isKey = isKeyMoment(state, candidates[0], candidates);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: isKey ? 500 : 200,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const content = response.content[0]?.type === 'text' 
      ? response.content[0].text 
      : '{}';
    
    // JSONを抽出（マークダウンコードブロック対応）
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    
    return {
      chosen: parsed.chosen || candidates[0],
      summary: parsed.summary || '状況を見て判断。',
      detail: isKey ? parsed.detail : null,
      structured: {
        candidates: candidates.map(c => ({ tile: c, reason_short: '' })),
        risk: parsed.risk || 'medium',
        mode: parsed.mode || 'balance',
        target_yaku: parsed.target_yaku || [],
        key_tiles: parsed.key_tiles || [],
        is_riichi_decision: candidates.some(c => c.includes('リーチ')),
        is_oshihiki: parsed.is_oshihiki || false,
      },
      tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens || 0,
      model: 'claude-3-haiku',
    };
  } catch (error) {
    console.error('Anthropic API error:', error);
    return fallbackDecision(candidates);
  }
}

// フォールバック（API失敗時）
function fallbackDecision(candidates: string[]): LLMDecision {
  return {
    chosen: candidates[0],
    summary: '手牌を整理する。',
    detail: null,
    structured: {
      candidates: candidates.map(c => ({ tile: c, reason_short: '' })),
      risk: 'medium',
      mode: 'balance',
    },
    tokensUsed: 0,
    model: 'fallback',
  };
}

// 鳴き判断の型
export interface NakiDecision {
  shouldCall: boolean;
  reason: string;
}

// 鳴き判断関数
export async function decideNaki(
  twin: Twin,
  state: any,
  callType: 'pon' | 'chi',
  tile: string,
  preferredModel: 'openai' | 'anthropic' = 'openai'
): Promise<NakiDecision> {
  const system = `${twin.persona_prompt}

あなたは麻雀の鳴き判断をします。${callType === 'pon' ? 'ポン' : 'チー'}するかどうかを判断してください。
公開手牌ルール（全員の手牌が見える）です。
JSON形式で返答してください。`;

  const playerState = state.players?.[state.currentActor];
  const user = `${callType === 'pon' ? 'ポン' : 'チー'}可能な牌: ${tile}
自分の手牌: ${playerState?.hand?.join(' ') || '不明'}
残りツモ: ${state.remainingTiles}

以下のJSON形式で返答:
{"should_call": true/false, "reason": "理由（30文字以内）"}`;

  try {
    if (preferredModel === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 100,
        system,
        messages: [{ role: 'user', content: user }],
      });
      const content = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      return { shouldCall: parsed.should_call ?? false, reason: parsed.reason || '' };
    }

    if (process.env.OPENAI_API_KEY) {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 100,
        temperature: 0.7,
      });
      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);
      return { shouldCall: parsed.should_call ?? false, reason: parsed.reason || '' };
    }
  } catch (e) {
    console.error('Naki LLM error:', e);
  }

  // フォールバック: style_paramsに基づく判断
  const nakiTendency = twin.style_params?.naki_tendency ?? 50;
  return {
    shouldCall: Math.random() * 100 < nakiTendency * (callType === 'chi' ? 0.7 : 1),
    reason: 'フォールバック判断',
  };
}

// メイン決定関数
export async function decide(
  twin: Twin,
  state: any,
  candidates: string[],
  allHands: any[],
  preferredModel: 'openai' | 'anthropic' = 'openai'
): Promise<LLMDecision> {
  if (preferredModel === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
    return decideWithAnthropic(twin, state, candidates, allHands);
  }
  if (process.env.OPENAI_API_KEY) {
    return decideWithOpenAI(twin, state, candidates, allHands);
  }
  return fallbackDecision(candidates);
}
