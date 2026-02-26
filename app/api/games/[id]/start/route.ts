import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { MahjongEngine, tileToName } from '@/lib/mahjong-engine';
import type { Twin } from '@/lib/types';

export const maxDuration = 60; // Vercel Pro: 60秒まで

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: gameId } = await params;

  try {
    const supabase = await createServiceClient();

    // ゲーム情報を取得
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single();

    if (gameError || !game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    if (game.status !== 'queued') {
      return NextResponse.json({ error: 'Game already started' }, { status: 400 });
    }

    // Twinsを取得
    const { data: twins } = await supabase
      .from('twins')
      .select('*')
      .in('id', game.player_twin_ids);

    if (!twins || twins.length !== 4) {
      return NextResponse.json({ error: 'Invalid twins' }, { status: 400 });
    }

    // 席順に並べ替え
    const orderedTwins: Twin[] = game.player_twin_ids.map((twinId: string) =>
      twins.find(t => t.id === twinId)
    );

    // ゲームステータスを更新
    await supabase
      .from('games')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .eq('id', gameId);

    // 対局を実行
    await runGame(gameId, orderedTwins, supabase);

    return NextResponse.json({ success: true, gameId });
  } catch (error: any) {
    console.error('Start game error:', error);

    try {
      const supabase = await createServiceClient();
      await supabase
        .from('games')
        .update({ status: 'failed' })
        .eq('id', gameId);
    } catch {}

    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ─── シャンテン名称 ─────────────────────────────────────────
const SHANTEN_NAMES = ['テンパイ', 'イーシャンテン', 'リャンシャンテン', 'サンシャンテン'];
function shantenLabel(n: number): string {
  return SHANTEN_NAMES[n] || `${n}シャンテン`;
}

// ═══════════════════════════════════════════════════════════════
// 漫画風思考テキスト生成器 (Manga-style Reasoning Text Generator)
// ─── Akagi / Saki / Tenpai inspired strategic narration ──────
// ═══════════════════════════════════════════════════════════════

// ─── 牌ユーティリティ (Tile Utilities) ───────────────────────

/** 牌の数字部分を取得 (0=赤5は5として扱う) */
function tileNum(tile: string): number {
  const n = parseInt(tile.slice(0, -1));
  return n === 0 ? 5 : n;
}

/** 牌のスート部分を取得 */
function tileSuit(tile: string): string {
  return tile.slice(-1);
}

/** 牌が数牌かどうか */
function isNumberTile(tile: string): boolean {
  const s = tileSuit(tile);
  return s === 'm' || s === 'p' || s === 's';
}

/** 牌が字牌かどうか */
function isHonorTile(tile: string): boolean {
  return tileSuit(tile) === 'z';
}

/** 牌が么九牌（端牌・字牌）かどうか */
function isTerminalOrHonor(tile: string): boolean {
  if (isHonorTile(tile)) return true;
  const n = tileNum(tile);
  return n === 1 || n === 9;
}

/** 牌が赤ドラかどうか */
function isAkaDora(tile: string): boolean {
  return tile.startsWith('0');
}

/** スート名を日本語で取得 */
function suitNameJa(suit: string): string {
  const names: Record<string, string> = { m: '萬子', p: '筒子', s: '索子', z: '字牌' };
  return names[suit] || suit;
}

/** スート略称を取得 */
function suitShort(suit: string): string {
  const names: Record<string, string> = { m: '萬', p: '筒', s: '索' };
  return names[suit] || '';
}

/** 字牌名を取得 */
function honorName(tile: string): string {
  const names: Record<string, string> = {
    '1z': '東', '2z': '南', '3z': '西', '4z': '北',
    '5z': '白', '6z': '發', '7z': '中',
  };
  return names[tile] || tile;
}

/** 風牌の席インデックス → 字牌ID */
function seatToWindTile(seat: number, dealerSeat: number): string {
  const windIndex = ((seat - dealerSeat) + 4) % 4;
  return `${windIndex + 1}z`; // 1z=東, 2z=南, 3z=西, 4z=北
}

/** 牌の表示名（漫画テキスト用。赤ドラは「赤」付き） */
function tilePretty(tile: string): string {
  if (isAkaDora(tile)) {
    const s = tileSuit(tile);
    return `赤5${suitShort(s)}`;
  }
  return tileToName(tile);
}

// ─── 手牌構造解析 (Hand Structure Analysis) ──────────────────

interface TileGroup {
  suit: string;
  tiles: string[];
  nums: number[];
}

interface Mentsu {
  type: 'shuntsu' | 'koutsu';  // 順子 or 刻子
  tiles: string[];
  description: string;
}

interface Tatsu {
  type: 'ryanmen' | 'penchan' | 'kanchan' | 'toitsu'; // 両面, 辺張, 嵌張, 対子
  tiles: string[];
  description: string;
  waitDescription: string;
}

interface IsolatedTile {
  tile: string;
  reason: string; // 孤立理由
}

interface HandStructure {
  groups: TileGroup[];
  mentsu: Mentsu[];
  tatsu: Tatsu[];
  isolated: IsolatedTile[];
  pairs: string[][]; // 対子一覧
  honorTiles: string[];
  terminalCount: number;
  middleCount: number;  // 2-8の牌数
  suitDistribution: Record<string, number>;
}

/** スートごとに牌をグループ化 */
function groupBySuit(hand: string[]): TileGroup[] {
  const map: Record<string, string[]> = {};
  for (const tile of hand) {
    const s = tileSuit(tile);
    if (!map[s]) map[s] = [];
    map[s].push(tile);
  }
  const groups: TileGroup[] = [];
  for (const suit of ['m', 'p', 's', 'z']) {
    if (map[suit] && map[suit].length > 0) {
      const tiles = map[suit].sort((a, b) => tileNum(a) - tileNum(b));
      groups.push({
        suit,
        tiles,
        nums: tiles.map(t => tileNum(t)),
      });
    }
  }
  return groups;
}

/** 数値配列から面子・ターツ・孤立牌を抽出する */
function analyzeHandStructure(hand: string[]): HandStructure {
  const groups = groupBySuit(hand);
  const mentsu: Mentsu[] = [];
  const tatsu: Tatsu[] = [];
  const isolated: IsolatedTile[] = [];
  const pairs: string[][] = [];
  const honorTiles: string[] = [];
  let terminalCount = 0;
  let middleCount = 0;
  const suitDistribution: Record<string, number> = { m: 0, p: 0, s: 0, z: 0 };

  for (const tile of hand) {
    const s = tileSuit(tile);
    suitDistribution[s] = (suitDistribution[s] || 0) + 1;
    if (isHonorTile(tile)) honorTiles.push(tile);
    if (isTerminalOrHonor(tile)) terminalCount++;
    if (isNumberTile(tile) && !isTerminalOrHonor(tile)) middleCount++;
  }

  for (const group of groups) {
    if (group.suit === 'z') {
      // 字牌: 刻子か対子か孤立
      analyzeHonorGroup(group, mentsu, tatsu, pairs, isolated);
    } else {
      // 数牌: 面子・ターツ・孤立を抽出
      analyzeNumberGroup(group, mentsu, tatsu, pairs, isolated);
    }
  }

  return {
    groups,
    mentsu,
    tatsu,
    isolated,
    pairs,
    honorTiles,
    terminalCount,
    middleCount,
    suitDistribution,
  };
}

/** 字牌グループの解析 */
function analyzeHonorGroup(
  group: TileGroup,
  mentsu: Mentsu[],
  tatsu: Tatsu[],
  pairs: string[][],
  isolated: IsolatedTile[],
): void {
  // 同じ牌の出現回数をカウント
  const counts: Record<number, string[]> = {};
  for (const tile of group.tiles) {
    const n = tileNum(tile);
    if (!counts[n]) counts[n] = [];
    counts[n].push(tile);
  }
  for (const [, tiles] of Object.entries(counts)) {
    if (tiles.length >= 3) {
      mentsu.push({
        type: 'koutsu',
        tiles: tiles.slice(0, 3),
        description: `${honorName(tiles[0])}刻子`,
      });
    } else if (tiles.length === 2) {
      pairs.push(tiles);
      tatsu.push({
        type: 'toitsu',
        tiles,
        description: `${honorName(tiles[0])}対子`,
        waitDescription: `${honorName(tiles[0])}待ち`,
      });
    } else {
      isolated.push({
        tile: tiles[0],
        reason: '孤立字牌',
      });
    }
  }
}

/** 数牌グループの解析（面子・ターツ・孤立を検出） */
function analyzeNumberGroup(
  group: TileGroup,
  mentsu: Mentsu[],
  tatsu: Tatsu[],
  pairs: string[][],
  isolated: IsolatedTile[],
): void {
  const s = group.suit;
  const sName = suitShort(s);

  // 数値ごとの枚数カウント
  const numCounts: Record<number, number> = {};
  const numTiles: Record<number, string[]> = {};
  for (const tile of group.tiles) {
    const n = tileNum(tile);
    numCounts[n] = (numCounts[n] || 0) + 1;
    if (!numTiles[n]) numTiles[n] = [];
    numTiles[n].push(tile);
  }

  const nums = Object.keys(numCounts).map(Number).sort((a, b) => a - b);
  const used = new Set<number>();

  // Pass 1: 刻子を検出
  for (const n of nums) {
    if (numCounts[n] >= 3) {
      mentsu.push({
        type: 'koutsu',
        tiles: numTiles[n].slice(0, 3),
        description: `${n}${sName}刻子`,
      });
      numCounts[n] -= 3;
      if (numCounts[n] === 0) used.add(n);
    }
  }

  // Pass 2: 順子を検出
  for (const n of nums) {
    if (used.has(n)) continue;
    while (numCounts[n] > 0 && numCounts[n + 1] > 0 && numCounts[n + 2] > 0) {
      mentsu.push({
        type: 'shuntsu',
        tiles: [numTiles[n][0], numTiles[n + 1]?.[0] || `${n + 1}${s}`, numTiles[n + 2]?.[0] || `${n + 2}${s}`],
        description: `${n}-${n + 1}-${n + 2}${sName}`,
      });
      numCounts[n]--;
      numCounts[n + 1]--;
      numCounts[n + 2]--;
      if (numCounts[n] === 0) used.add(n);
      if (numCounts[n + 1] === 0) used.add(n + 1);
      if (numCounts[n + 2] === 0) used.add(n + 2);
    }
  }

  // Pass 3: 対子を検出
  for (const n of nums) {
    if (used.has(n)) continue;
    if (numCounts[n] >= 2) {
      pairs.push([numTiles[n][0], numTiles[n][1] || `${n}${s}`]);
      tatsu.push({
        type: 'toitsu',
        tiles: [numTiles[n][0], numTiles[n][1] || `${n}${s}`],
        description: `${n}${sName}対子`,
        waitDescription: `${n}${sName}単騎待ち`,
      });
      numCounts[n] -= 2;
      if (numCounts[n] === 0) used.add(n);
    }
  }

  // Pass 4: ターツ（両面・辺張・嵌張）を検出
  const remainingNums = nums.filter(n => !used.has(n) && numCounts[n] > 0);

  for (let i = 0; i < remainingNums.length; i++) {
    const n = remainingNums[i];
    if (numCounts[n] <= 0) continue;

    // 連続 (n, n+1) → 両面 or 辺張
    const next = remainingNums.find(x => x === n + 1 && numCounts[x] > 0);
    if (next !== undefined) {
      let tatsuType: 'ryanmen' | 'penchan';
      let waitDesc: string;
      if (n === 1) {
        tatsuType = 'penchan';
        waitDesc = `${n + 2}${sName}待ち(辺張)`;
      } else if (n + 1 === 9) {
        tatsuType = 'penchan';
        waitDesc = `${n - 1 + 1}${sName}待ち(辺張)`;
      } else {
        tatsuType = 'ryanmen';
        waitDesc = `${n - 1}${sName}・${n + 2}${sName}待ち(両面)`;
      }
      tatsu.push({
        type: tatsuType,
        tiles: [numTiles[n][0], numTiles[next]?.[0] || `${next}${s}`],
        description: `${n}-${next}${sName}${tatsuType === 'ryanmen' ? '両面' : '辺張'}`,
        waitDescription: waitDesc,
      });
      numCounts[n]--;
      numCounts[next]--;
      if (numCounts[n] <= 0) used.add(n);
      if (numCounts[next] <= 0) used.add(next);
      continue;
    }

    // 1つ飛び (n, n+2) → 嵌張
    const skip = remainingNums.find(x => x === n + 2 && numCounts[x] > 0);
    if (skip !== undefined) {
      tatsu.push({
        type: 'kanchan',
        tiles: [numTiles[n][0], numTiles[skip]?.[0] || `${skip}${s}`],
        description: `${n}-${skip}${sName}嵌張`,
        waitDescription: `${n + 1}${sName}待ち(嵌張)`,
      });
      numCounts[n]--;
      numCounts[skip]--;
      if (numCounts[n] <= 0) used.add(n);
      if (numCounts[skip] <= 0) used.add(skip);
      continue;
    }

    // 孤立牌
    if (numCounts[n] > 0) {
      const tile = numTiles[n][0];
      const num = tileNum(tile);
      let reason: string;
      if (num === 1 || num === 9) {
        reason = '孤立端牌';
      } else {
        // 隣接牌が手牌にあるかチェック
        const hasNeighbor = remainingNums.some(x => Math.abs(x - n) <= 2 && x !== n && numCounts[x] > 0);
        reason = hasNeighbor ? '半孤立牌' : '孤立牌';
      }
      isolated.push({ tile, reason });
      numCounts[n]--;
      if (numCounts[n] <= 0) used.add(n);
    }
  }
}

// ─── 役判定 (Yaku Detection) ────────────────────────────────

interface YakuPotential {
  name: string;
  confidence: 'high' | 'medium' | 'low';
  description: string;
}

/** 手牌全体（ツモ牌含む、打牌後の13枚）から狙える役を推定 */
function detectTargetYaku(
  handAfterDiscard: string[],
  melds: { type: string; tiles: string[] }[],
  structure: HandStructure,
  shanten: number,
  currentSeat: number,
  dealerSeat: number,
): YakuPotential[] {
  const yaku: YakuPotential[] = [];
  const isClosed = melds.length === 0;
  const allTiles = [...handAfterDiscard];

  // タンヤオ判定: 全て2-8の数牌
  const hasTerminalOrHonor = allTiles.some(t => isTerminalOrHonor(t));
  const meldHasTerminalOrHonor = melds.some(m => m.tiles.some(t => isTerminalOrHonor(t)));
  if (!hasTerminalOrHonor && !meldHasTerminalOrHonor) {
    yaku.push({ name: 'タンヤオ', confidence: 'high', description: '全て中張牌' });
  } else {
    // タンヤオ含みかどうか: 么九牌が少ない場合
    const termCount = allTiles.filter(t => isTerminalOrHonor(t)).length;
    if (termCount <= 2 && structure.middleCount >= allTiles.length - 2 && !meldHasTerminalOrHonor) {
      yaku.push({ name: 'タンヤオ', confidence: 'low', description: 'タンヤオ含み' });
    }
  }

  // ピンフ判定: 門前、全順子構成、非役牌雀頭、両面待ち
  if (isClosed) {
    const hasKoutsu = structure.mentsu.some(m => m.type === 'koutsu');
    const ryanmenCount = structure.tatsu.filter(t => t.type === 'ryanmen').length;
    const shuntsuCount = structure.mentsu.filter(m => m.type === 'shuntsu').length;
    if (!hasKoutsu && shuntsuCount >= 2 && ryanmenCount >= 1) {
      // 雀頭が非役牌かどうか
      const pairIsNonYakuhai = structure.pairs.length > 0 && structure.pairs.every(p => {
        const tile = p[0];
        if (!isHonorTile(tile)) return true;
        // 三元牌は役牌
        if (['5z', '6z', '7z'].includes(tile)) return false;
        // 自風・場風は役牌
        const selfWind = seatToWindTile(currentSeat, dealerSeat);
        if (tile === selfWind || tile === '1z') return false; // 東は常に場風(東風戦)
        return true;
      });
      if (pairIsNonYakuhai) {
        yaku.push({ name: 'ピンフ', confidence: shanten <= 1 ? 'high' : 'medium', description: '順子手・両面待ち' });
      }
    }
  }

  // 役牌判定
  const yakuhaiTiles = ['5z', '6z', '7z']; // 白發中
  const selfWind = seatToWindTile(currentSeat, dealerSeat);
  const roundWind = '1z'; // 東風戦は常に東

  const allYakuhaiCandidates = [...yakuhaiTiles];
  if (!allYakuhaiCandidates.includes(selfWind)) allYakuhaiCandidates.push(selfWind);
  if (!allYakuhaiCandidates.includes(roundWind)) allYakuhaiCandidates.push(roundWind);

  for (const yt of allYakuhaiCandidates) {
    const countInHand = allTiles.filter(t => t === yt || (tileNum(t) === tileNum(yt) && tileSuit(t) === tileSuit(yt))).length;
    const countInMelds = melds.reduce((c, m) => c + m.tiles.filter(t => t === yt).length, 0);
    const total = countInHand + countInMelds;
    const name = honorName(yt);
    if (total >= 3) {
      yaku.push({ name: `役牌(${name})`, confidence: 'high', description: `${name}刻子完成` });
    } else if (total === 2) {
      yaku.push({ name: `役牌(${name})`, confidence: 'medium', description: `${name}対子あり` });
    }
  }

  // 混一色/清一色判定
  const numberSuits = ['m', 'p', 's'];
  for (const suit of numberSuits) {
    const suitCount = structure.suitDistribution[suit] || 0;
    const honorCount = structure.suitDistribution['z'] || 0;
    const meldSuitTiles = melds.flatMap(m => m.tiles).filter(t => tileSuit(t) === suit).length;
    const meldHonorTiles = melds.flatMap(m => m.tiles).filter(t => isHonorTile(t)).length;
    const otherSuitCount = numberSuits
      .filter(x => x !== suit)
      .reduce((sum, x) => sum + (structure.suitDistribution[x] || 0), 0);
    const meldOtherSuit = melds.flatMap(m => m.tiles).filter(t => isNumberTile(t) && tileSuit(t) !== suit).length;

    const totalInSuit = suitCount + meldSuitTiles;
    const totalOther = otherSuitCount + meldOtherSuit;

    if (totalOther === 0 && totalInSuit >= 8) {
      if (honorCount + meldHonorTiles === 0) {
        yaku.push({ name: '清一色', confidence: shanten <= 1 ? 'high' : 'medium', description: `${suitNameJa(suit)}のみ` });
      } else {
        yaku.push({ name: '混一色', confidence: shanten <= 1 ? 'high' : 'medium', description: `${suitNameJa(suit)}+字牌` });
      }
    } else if (totalOther <= 2 && totalInSuit >= 7) {
      if (honorCount + meldHonorTiles > 0) {
        yaku.push({ name: '混一色', confidence: 'low', description: `${suitNameJa(suit)}寄せ含み` });
      }
    }
  }

  // 七対子判定: 4対子以上
  if (isClosed && structure.pairs.length >= 4) {
    const pairCount = structure.pairs.length;
    if (pairCount >= 6) {
      yaku.push({ name: '七対子', confidence: 'high', description: `${pairCount}対子` });
    } else if (pairCount >= 4) {
      yaku.push({ name: '七対子', confidence: shanten <= 2 ? 'medium' : 'low', description: `${pairCount}対子` });
    }
  }

  // 一盃口判定: 同じ順子が2つ
  if (isClosed) {
    const shuntsuDescriptions = structure.mentsu.filter(m => m.type === 'shuntsu').map(m => m.description);
    const descCounts: Record<string, number> = {};
    for (const d of shuntsuDescriptions) {
      descCounts[d] = (descCounts[d] || 0) + 1;
    }
    for (const [desc, count] of Object.entries(descCounts)) {
      if (count >= 2) {
        yaku.push({ name: '一盃口', confidence: 'medium', description: `${desc}の重複` });
      }
    }
  }

  // 対々和判定: 刻子系が多い場合
  const koutsuCount = structure.mentsu.filter(m => m.type === 'koutsu').length;
  const meldKoutsu = melds.filter(m => m.type === 'pon' || m.type === 'kan' || m.type === 'ankan' || m.type === 'daiminkan' || m.type === 'kakan').length;
  if (koutsuCount + meldKoutsu >= 3) {
    yaku.push({ name: '対々和', confidence: 'medium', description: '刻子手' });
  } else if (koutsuCount + meldKoutsu >= 2 && structure.tatsu.filter(t => t.type === 'toitsu').length >= 1) {
    yaku.push({ name: '対々和', confidence: 'low', description: '対々含み' });
  }

  return yaku;
}

// ─── 打牌理由分析 (Discard Reason Analysis) ──────────────────

interface DiscardReason {
  primary: string;   // 主な理由
  secondary: string | null;  // 補足理由
}

/** 打牌の理由を分析 */
function analyzeDiscardReason(
  discardTile: string,
  hand: string[],
  tsumo: string | undefined,
  structure: HandStructure,
  shanten: number,
  anyRiichi: boolean,
): DiscardReason {
  const dNum = tileNum(discardTile);
  const dSuit = tileSuit(discardTile);

  // 孤立牌判定: structure.isolated に含まれるか
  const isIsolated = structure.isolated.some(i => i.tile === discardTile);

  // ツモ切り判定
  const isTsumogiri = tsumo === discardTile;

  // 字牌判定
  if (isHonorTile(discardTile)) {
    if (isIsolated) {
      return {
        primary: `孤立した${honorName(discardTile)}を処理`,
        secondary: anyRiichi ? '安全度も高い字牌整理' : '字牌整理で手を狭めない',
      };
    }
    return {
      primary: `${honorName(discardTile)}を切り出し`,
      secondary: '役牌にならない字牌を先行処理',
    };
  }

  // 端牌（1,9）
  if (dNum === 1 || dNum === 9) {
    if (isIsolated) {
      return {
        primary: `孤立した端牌${dNum}${suitShort(dSuit)}を整理`,
        secondary: 'ターツ変化の少ない端牌を先切り',
      };
    }
    return {
      primary: `端牌整理。${dNum}${suitShort(dSuit)}切り`,
      secondary: null,
    };
  }

  // 2,8牌
  if (dNum === 2 || dNum === 8) {
    if (isIsolated) {
      return {
        primary: `孤立${dNum}${suitShort(dSuit)}を処理`,
        secondary: '片面にしかターツが作れない準端牌',
      };
    }
  }

  // 安全牌（他家リーチ中）
  if (anyRiichi) {
    return {
      primary: `他家リーチに対し${tilePretty(discardTile)}切り`,
      secondary: shanten <= 1 ? '押し返しの一打。テンパイ取りを優先' : '安全寄りの一打',
    };
  }

  // ツモ切り
  if (isTsumogiri) {
    if (shanten === 0) {
      return {
        primary: `テンパイ維持。ツモ${tilePretty(discardTile)}は不要牌`,
        secondary: '待ちを変えず現テンパイを維持',
      };
    }
    return {
      primary: `ツモ${tilePretty(discardTile)}は手に馴染まず切り`,
      secondary: null,
    };
  }

  // 受入最大化（デフォルト）
  if (isIsolated) {
    return {
      primary: `孤立した${tilePretty(discardTile)}を切って受入最大化`,
      secondary: '同色の近隣牌が手牌になく、変化の薄い牌を処理',
    };
  }

  // 形の選択（ターツ落とし等）
  const inTatsu = structure.tatsu.some(t => t.tiles.some(tt =>
    tileNum(tt) === dNum && tileSuit(tt) === dSuit
  ));
  if (inTatsu) {
    return {
      primary: `形の選択。${tilePretty(discardTile)}のターツを崩す`,
      secondary: 'より受入の広いターツ構成を優先',
    };
  }

  return {
    primary: `${tilePretty(discardTile)}切りで手牌を整理`,
    secondary: null,
  };
}

// ─── ゲーム局面判定 (Game Phase Detection) ───────────────────

interface GamePhase {
  name: string;       // 序盤, 中盤, 終盤
  tag: string;        // [序盤], [中盤], [終盤]
  remaining: number;
  riichiPlayers: number[];
  isUrgent: boolean;
}

function detectGamePhase(
  gameState: any,
  currentSeat: number,
): GamePhase {
  const remaining = gameState.remainingTiles ?? 70;
  const players = gameState.players || [];

  const riichiPlayers = players
    .filter((p: any) => p.riichi && p.seat !== currentSeat)
    .map((p: any) => p.seat);

  let name: string;
  let tag: string;
  let isUrgent = false;

  if (remaining > 50) {
    name = '序盤';
    tag = '[序盤]';
  } else if (remaining > 20) {
    name = '中盤';
    tag = '[中盤]';
  } else {
    name = '終盤';
    tag = '[終盤]';
    isUrgent = true;
  }

  if (riichiPlayers.length > 0) {
    isUrgent = true;
  }

  return { name, tag, remaining, riichiPlayers, isUrgent };
}

// ─── 手牌構成テキスト生成 (Hand Structure Text) ─────────────

/** 手牌構成を簡潔なテキストにする */
function buildHandStructureText(structure: HandStructure): string {
  const parts: string[] = [];

  for (const group of structure.groups) {
    if (group.suit === 'z') continue; // 字牌は別途

    const sName = suitNameJa(group.suit);
    const descriptions: string[] = [];

    // この色の面子
    const suitMentsu = structure.mentsu.filter(m =>
      m.tiles.some(t => tileSuit(t) === group.suit)
    );
    for (const m of suitMentsu) {
      descriptions.push(`${m.description}完成`);
    }

    // この色のターツ
    const suitTatsu = structure.tatsu.filter(t =>
      t.tiles.some(tt => tileSuit(tt) === group.suit) && t.type !== 'toitsu'
    );
    for (const t of suitTatsu) {
      descriptions.push(t.description);
    }

    // この色の対子
    const suitPairs = structure.tatsu.filter(t =>
      t.type === 'toitsu' && t.tiles.some(tt => tileSuit(tt) === group.suit)
    );
    for (const p of suitPairs) {
      descriptions.push(p.description);
    }

    // この色の孤立牌
    const suitIsolated = structure.isolated.filter(i => tileSuit(i.tile) === group.suit);
    for (const iso of suitIsolated) {
      descriptions.push(`${tilePretty(iso.tile)}孤立`);
    }

    if (descriptions.length > 0) {
      parts.push(`${sName}(${descriptions.join(', ')})`);
    }
  }

  // 字牌
  if (structure.honorTiles.length > 0) {
    const honorDescs: string[] = [];
    const honorMentsu = structure.mentsu.filter(m => m.tiles.some(t => isHonorTile(t)));
    for (const m of honorMentsu) honorDescs.push(m.description);
    const honorTatsu = structure.tatsu.filter(t => t.tiles.some(tt => isHonorTile(tt)));
    for (const t of honorTatsu) honorDescs.push(t.description);
    const honorIso = structure.isolated.filter(i => isHonorTile(i.tile));
    for (const iso of honorIso) honorDescs.push(`${honorName(iso.tile)}孤立`);
    if (honorDescs.length > 0) {
      parts.push(`字牌(${honorDescs.join(', ')})`);
    }
  }

  return parts.join('、');
}

// ─── 副露テキスト (Meld Text) ───────────────────────────────

function buildMeldText(melds: { type: string; tiles: string[] }[]): string {
  if (melds.length === 0) return '';
  const parts = melds.map(m => {
    const tilesStr = m.tiles.map(t => tilePretty(t)).join('');
    switch (m.type) {
      case 'chi': return `チー(${tilesStr})`;
      case 'pon': return `ポン(${tilesStr})`;
      case 'ankan': return `暗槓(${tilesStr})`;
      case 'daiminkan': case 'kakan': return `槓(${tilesStr})`;
      default: return tilesStr;
    }
  });
  return parts.join('、') + '済み';
}

// ─── メイン関数: generateMangaReasoning ─────────────────────

function generateMangaReasoning(
  twinName: string,
  hand: string[],
  tsumo: string | undefined,
  melds: { type: string; tiles: string[] }[],
  discardTile: string,
  shanten: number,
  ukeireCount: number,
  gameState: any,
  currentSeat: number,
): { summary: string; detail: string | null; mode: string; risk: string } {
  // --- 基本情報 ---
  const dealerSeat = gameState.dealerSeat ?? 0;
  const phase = detectGamePhase(gameState, currentSeat);
  const sl = shantenLabel(shanten);
  const discardName = tilePretty(discardTile);
  const isClosed = melds.length === 0;

  // --- 打牌後の手牌を構築 ---
  const allTiles = [...hand];
  if (tsumo) allTiles.push(tsumo);
  const afterDiscard = [...allTiles];
  const discardIdx = afterDiscard.indexOf(discardTile);
  if (discardIdx >= 0) afterDiscard.splice(discardIdx, 1);

  // --- 手牌構造解析 ---
  const structure = analyzeHandStructure(afterDiscard);

  // --- 役判定 ---
  const targetYaku = detectTargetYaku(afterDiscard, melds, structure, shanten, currentSeat, dealerSeat);

  // --- 打牌理由 ---
  const anyRiichi = phase.riichiPlayers.length > 0;
  const discardReason = analyzeDiscardReason(discardTile, hand, tsumo, structure, shanten, anyRiichi);

  // --- リスク・モード判定 ---
  let risk: 'low' | 'medium' | 'high' = 'medium';
  let mode: 'push' | 'pull' | 'balance' = 'balance';

  if (anyRiichi) {
    risk = 'high';
    if (shanten === 0) {
      mode = 'push';
    } else if (shanten === 1) {
      // イーシャンテンで受入多ければ攻め
      mode = ukeireCount >= 4 ? 'push' : 'balance';
    } else {
      mode = 'pull';
    }
  } else if (shanten === 0) {
    risk = 'low';
    mode = 'push';
  } else if (phase.remaining <= 20) {
    if (shanten <= 1) {
      risk = 'medium';
      mode = 'push';
    } else {
      risk = 'high';
      mode = 'pull';
    }
  } else if (shanten <= 1) {
    risk = 'low';
    mode = 'push';
  }

  // --- 役テキスト構築 ---
  const highYaku = targetYaku.filter(y => y.confidence === 'high');
  const medYaku = targetYaku.filter(y => y.confidence === 'medium');
  const lowYaku = targetYaku.filter(y => y.confidence === 'low');

  let yakuText = '';
  if (highYaku.length > 0) {
    yakuText = highYaku.map(y => y.name).join('・');
    if (medYaku.length > 0) {
      yakuText += `含みで${medYaku.map(y => y.name).join('・')}も視野`;
    }
  } else if (medYaku.length > 0) {
    yakuText = medYaku.map(y => y.name).join('・') + '含み';
    if (lowYaku.length > 0 && lowYaku.length <= 2) {
      yakuText += `。${lowYaku.map(y => y.name).join('・')}の両天秤`;
    }
  } else if (lowYaku.length > 0) {
    yakuText = lowYaku.map(y => y.name).join('・') + 'の可能性を残す';
  }

  // --- 面子カウント ---
  const completeMentsuCount = structure.mentsu.length + melds.length;
  const tatsuCount = structure.tatsu.filter(t => t.type !== 'toitsu').length;
  const pairCount = structure.pairs.length;

  // --- 手牌構成サマリ ---
  const mentsuNames = structure.mentsu.map(m => m.description).join('と');
  const tatsuNames = structure.tatsu.filter(t => t.type !== 'toitsu').map(t => t.description).join('、');

  // --- 副露テキスト ---
  const meldText = buildMeldText(melds);

  // === summary 生成 ===
  let summary = '';

  if (shanten === 0) {
    // テンパイ
    const waitTatsu = structure.tatsu.filter(t => t.type !== 'toitsu');
    const waitDesc = waitTatsu.length > 0
      ? waitTatsu.map(t => t.waitDescription).join('・')
      : `${discardName}切りでテンパイ維持`;

    if (anyRiichi) {
      const riichiSeatNames = phase.riichiPlayers.map(s => {
        const winds = ['東家', '南家', '西家', '北家'];
        const w = ((s - dealerSeat) + 4) % 4;
        return winds[w];
      }).join('・');
      summary = `${phase.tag} ${riichiSeatNames}リーチ！だがこちらもテンパイ。${discardName}を切り放ち勝負に出る。`;
      if (yakuText) summary += `${yakuText}。`;
      summary += `${waitDesc}。受入${ukeireCount}種。`;
    } else {
      summary = `${phase.tag} テンパイ！`;
      if (mentsuNames) summary += `${mentsuNames}の${completeMentsuCount}面子完成。`;
      summary += `${discardName}切りで聴牌を取る。`;
      if (yakuText) summary += `${yakuText}。`;
      summary += `受入${ukeireCount}種。`;
    }

    if (meldText) summary += `(${meldText})`;

  } else if (shanten === 1) {
    // イーシャンテン
    if (anyRiichi) {
      const riichiSeatNames = phase.riichiPlayers.map(s => {
        const winds = ['東家', '南家', '西家', '北家'];
        const w = ((s - dealerSeat) + 4) % 4;
        return winds[w];
      }).join('・');

      if (mode === 'push') {
        summary = `${phase.tag} ${riichiSeatNames}リーチ！こちらも${sl}。ここは攻め継続。`;
        summary += `${discardReason.primary}。`;
        if (yakuText) summary += `${yakuText}でテンパイに備える。`;
        summary += `受入${ukeireCount}種。`;
      } else {
        summary = `${phase.tag} ${riichiSeatNames}リーチに対し${sl}。`;
        summary += `${discardReason.primary}。`;
        summary += `受入${ukeireCount}種だが慎重に。`;
      }
    } else {
      summary = `${phase.tag} ${sl}！`;
      if (mentsuNames) summary += `${mentsuNames}の面子完成。`;
      if (tatsuNames) summary += `${tatsuNames}にあと1枚。`;
      summary += `${discardName}切りでテンパイに備える。`;
      if (yakuText) summary += `${yakuText}。`;
      summary += `受入${ukeireCount}種。`;
    }

  } else if (shanten === 2) {
    // リャンシャンテン
    summary = `${phase.tag} ${sl}。手牌整理。`;
    if (completeMentsuCount > 0 && mentsuNames) {
      summary += `${mentsuNames}の${completeMentsuCount}面子は確保。`;
    }
    summary += `${discardReason.primary}。`;
    if (yakuText) summary += `${yakuText}で手を進める。`;
    else summary += '手を広く構えて有効牌を待つ。';
    if (ukeireCount > 0) summary += `受入${ukeireCount}種。`;

  } else {
    // サンシャンテン以上
    summary = `${phase.tag} ${sl}。`;
    if (phase.name === '序盤') {
      summary += '焦る必要はない。';
    } else if (phase.name === '終盤') {
      summary += '手が遠い...。';
    }
    summary += `${discardReason.primary}。`;
    if (yakuText) summary += `${yakuText}方面を意識して。`;
    else summary += '手牌の方向性を定めていく。';
    if (ukeireCount > 0) summary += `受入${ukeireCount}種。`;
  }

  // === detail 生成 ===
  let detail: string | null = null;

  // 重要局面ではdetailを生成
  const isImportant = shanten <= 1 || anyRiichi || phase.isUrgent || targetYaku.length >= 2 || melds.length > 0;

  if (isImportant) {
    const detailParts: string[] = [];

    // 手牌構成
    const structText = buildHandStructureText(structure);
    if (structText) {
      detailParts.push(`手牌構成: ${structText}。`);
    }

    // 副露情報
    if (meldText) {
      detailParts.push(`副露: ${meldText}。`);
    }

    // ターツ状況
    if (tatsuCount > 0 || pairCount > 0) {
      const blockInfo: string[] = [];
      if (tatsuCount > 0) blockInfo.push(`ターツ${tatsuCount}つ`);
      if (pairCount > 0) blockInfo.push(`対子${pairCount}つ`);
      if (completeMentsuCount > 0) blockInfo.push(`完成面子${completeMentsuCount}つ`);
      detailParts.push(`ブロック構成: ${blockInfo.join('、')}。`);
    }

    // 打牌理由の詳細
    detailParts.push(`打${discardName}: ${discardReason.primary}。`);
    if (discardReason.secondary) {
      detailParts.push(discardReason.secondary + '。');
    }

    // 役の詳細分析
    if (targetYaku.length > 0) {
      const yakuDetails = targetYaku.map(y => `${y.name}(${y.description})`).join('、');
      detailParts.push(`狙い目: ${yakuDetails}。`);
    }

    // 両天秤の説明
    if (highYaku.length >= 1 && medYaku.length >= 1) {
      detailParts.push(`${highYaku[0].name}本線だが、${medYaku.map(y => y.name).join('・')}への転換も可能。`);
    }

    // テンパイ時の待ち牌情報
    if (shanten === 0) {
      const waitInfo = structure.tatsu
        .filter(t => t.type !== 'toitsu')
        .map(t => t.waitDescription);
      if (waitInfo.length > 0) {
        detailParts.push(`待ち: ${waitInfo.join('、')}。`);
      }
    }

    // リーチ時の戦略
    if (anyRiichi) {
      if (mode === 'push') {
        detailParts.push(`他家リーチに対し${sl}のため攻め継続。受入を落とさず勝負する。`);
      } else if (mode === 'pull') {
        detailParts.push(`他家リーチ中で手が遠い。無理をせず安全牌を選択。`);
      } else {
        detailParts.push(`他家リーチ中。攻守のバランスを取りつつ進行。`);
      }
    }

    // 終盤の注意
    if (phase.name === '終盤' && shanten >= 2) {
      detailParts.push(`残り${phase.remaining}枚。テンパイは厳しく、オリも視野に入れる局面。`);
    }

    detail = detailParts.join('');
  }

  return { summary, detail, mode, risk };
}

// ─── 旧ヒューリスティック思考テキスト（互換ラッパー） ─────
function buildHeuristicReasoning(
  twin: Twin | undefined,
  tileName: string,
  shanten: number,
  ukeireCount: number,
  gameState: any,
  currentSeat: number,
): { summary: string; detail: string | null; mode: string; risk: string } {
  // 旧引数からgenerateMangaReasoningへ変換
  const twinName = twin?.name || '???';
  const players = gameState.players || [];
  const player = players[currentSeat];

  if (player) {
    const hand = player.hand || [];
    const tsumoTile = player.tsumo || undefined;
    const melds = (player.melds || []).map((m: any) => ({
      type: m.type,
      tiles: m.tiles || [],
    }));

    // tileName から元の牌IDを逆引き（最善努力）
    const allTiles = [...hand];
    if (tsumoTile) allTiles.push(tsumoTile);
    let discardTile = allTiles.find(t => tileToName(t) === tileName) || allTiles[0] || '1z';

    const result = generateMangaReasoning(
      twinName,
      hand,
      tsumoTile,
      melds,
      discardTile,
      shanten,
      ukeireCount,
      gameState,
      currentSeat,
    );
    return result;
  }

  // プレイヤー情報がない場合はフォールバック
  const anyRiichi = players.some((p: any) => p.riichi && p.seat !== currentSeat);
  const remaining = gameState.remainingTiles ?? 70;

  let risk: 'low' | 'medium' | 'high' = 'medium';
  let mode: 'push' | 'pull' | 'balance' = 'balance';

  if (anyRiichi) {
    risk = 'high';
    mode = shanten <= 1 ? 'push' : 'pull';
  } else if (shanten === 0) {
    risk = 'low';
    mode = 'push';
  } else if (remaining <= 20) {
    risk = shanten <= 1 ? 'medium' : 'high';
    mode = shanten <= 1 ? 'push' : 'pull';
  }

  const phase = remaining > 50 ? '[序盤]' : remaining > 20 ? '[中盤]' : '[終盤]';
  const sl = shantenLabel(shanten);

  let summary = `${phase} ${twinName}: ${sl}。${tileName}切り。`;
  if (ukeireCount > 0) summary += `受入${ukeireCount}種。`;

  let detail: string | null = null;
  if (anyRiichi) {
    detail = mode === 'push'
      ? `他家リーチに対し、${sl}のため攻め継続。${tileName}切りで受入を維持。`
      : `他家リーチ中で手が遠い。${tileName}を安全牌として処理。`;
  }

  return { summary, detail, mode, risk };
}

/**
 * 対局実行メインループ
 * 東風戦: 東1局〜東4局 (親連荘あり)
 * 全判断ヒューリスティック（LLMなし）
 * バッチDB書き込み: 局ごとにまとめて一括INSERT（~260回→2回/局に削減）
 */
async function runGame(gameId: string, twins: Twin[], supabase: any) {
  const engine = new MahjongEngine();
  let seqNo = 0;
  const startTime = Date.now();
  const MAX_RUNTIME_MS = 55000;

  // ─── バッチ書き込みバッファ ─────────────────────────────────
  const pendingActions: any[] = [];
  const pendingReasonings: any[] = [];

  /** バッファをDBにフラッシュ */
  async function flushBatch() {
    if (pendingActions.length > 0) {
      await supabase.from('actions').insert(pendingActions);
      pendingActions.length = 0;
    }
    if (pendingReasonings.length > 0) {
      await supabase.from('reasoning_logs').insert(pendingReasonings);
      pendingReasonings.length = 0;
    }
  }

  /** アクション（+思考ログ）をバッファに追加。クライアント側UUID生成でID紐付け */
  function queueAction(
    action: { game_id: string; hand_id: string; seq_no: number; actor_seat: number; action_type: string; payload_json: any },
    reasoning?: { summary_text: string; detail_text: string | null; structured_json: any; tokens_used: number; model_name: string },
  ) {
    if (reasoning) {
      const actionId = randomUUID();
      pendingActions.push({ id: actionId, ...action });
      pendingReasonings.push({ action_id: actionId, ...reasoning });
    } else {
      pendingActions.push(action);
    }
  }

  try {
    // === 東風戦ループ（最大4局 + 親連荘） ===
    while (!engine.isGameOver()) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        console.log('Timeout reached, flushing remaining actions');
        await flushBatch();
        break;
      }

      const state = engine.getState();

      // 局レコードを作成
      const { data: hand, error: handError } = await supabase
        .from('hands')
        .insert({
          game_id: gameId,
          hand_no: state.handNumber + 1,
          round: state.round,
          honba: state.honba,
          kyotaku: state.kyotaku,
          dealer_seat: state.dealerSeat,
        })
        .select()
        .single();

      if (handError) throw handError;
      const handId = hand.id;

      // 配牌をバッファに追加
      const initState = engine.getState();
      for (let seat = 0; seat < 4; seat++) {
        seqNo++;
        queueAction({
          game_id: gameId,
          hand_id: handId,
          seq_no: seqNo,
          actor_seat: seat,
          action_type: 'deal',
          payload_json: {
            tiles: initState.players[seat].hand,
            dora_indicators: initState.doraIndicators,
          },
        });
      }

      // === 局内ループ ===
      let handOver = false;
      let handResult: any = null;

      while (!handOver) {
        if (Date.now() - startTime > MAX_RUNTIME_MS) {
          handOver = true;
          break;
        }

        const currentState = engine.getState();
        const currentSeat = currentState.currentActor;
        const twin = twins[currentSeat];

        // === ツモフェーズ ===
        if (currentState.phase === 'draw') {
          // 流局チェック
          if (engine.isRyukyoku()) {
            handResult = engine.processRyukyoku();
            seqNo++;
            queueAction({
              game_id: gameId, hand_id: handId, seq_no: seqNo, actor_seat: currentSeat,
              action_type: 'ryukyoku',
              payload_json: { tenpai_seats: handResult.tenpaiSeats, score_changes: handResult.scoreChanges },
            });
            handOver = true;
            break;
          }

          const drawnTile = engine.draw();
          if (!drawnTile) {
            handResult = engine.processRyukyoku();
            handOver = true;
            break;
          }

          // ツモアクション
          seqNo++;
          queueAction({
            game_id: gameId, hand_id: handId, seq_no: seqNo, actor_seat: currentSeat,
            action_type: 'draw', payload_json: { tile: drawnTile },
          });

          // ツモ和了チェック
          if (engine.canTsumo(currentSeat)) {
            const winResult = engine.executeTsumo(currentSeat);
            if (winResult) {
              const yakuNames = winResult.yaku.map(([name, han]: [string, number]) => `${name}(${han}翻)`).join('・');
              seqNo++;
              queueAction({
                game_id: gameId, hand_id: handId, seq_no: seqNo, actor_seat: currentSeat,
                action_type: 'tsumo',
                payload_json: { tile: drawnTile, yaku: winResult.yaku, han: winResult.han, fu: winResult.fu, score_level: winResult.scoreLevel, score_changes: winResult.scoreChanges },
              }, {
                summary_text: `ツモ和了！${yakuNames} ${winResult.han}翻${winResult.fu}符`,
                detail_text: `ツモ牌: ${tileToName(drawnTile)}\n役: ${yakuNames}\n${winResult.han}翻${winResult.fu}符\n${winResult.scoreLevel}`,
                structured_json: { candidates: [], risk: 'low', mode: 'push', target_yaku: winResult.yaku.map(([name]: [string, number]) => name) },
                tokens_used: 0, model_name: 'engine',
              });
              handResult = { type: 'agari', winResult, scoreChanges: winResult.scoreChanges, dealerRetains: winResult.winnerSeat === engine.getDealerSeat() };
              handOver = true;
              break;
            }
          }

          // 九種九牌（AIは宣言しない）
          if (engine.canKyushukyuhai(currentSeat)) { /* 続行 */ }

          // === 暗槓チェック ===
          if (engine.canAnkan(currentSeat)) {
            const ankanCandidates = engine.getAnkanCandidates(currentSeat);
            if (ankanCandidates.length > 0) {
              const ankanTile = ankanCandidates[0];
              const success = engine.executeAnkan(currentSeat, ankanTile);
              if (success) {
                const kanMeld = engine.getState().players[currentSeat].melds.slice(-1)[0];
                seqNo++;
                queueAction({
                  game_id: gameId, hand_id: handId, seq_no: seqNo, actor_seat: currentSeat,
                  action_type: 'kan', payload_json: { kan_type: 'ankan', tiles: kanMeld?.tiles || [] },
                }, {
                  summary_text: `${twin?.name || '???'}が${tileToName(ankanTile)}を暗槓！手牌から4枚揃い。`,
                  detail_text: null,
                  structured_json: { candidates: [], risk: 'low', mode: 'push', target_yaku: [], is_naki_decision: true },
                  tokens_used: 0, model_name: 'engine',
                });

                // 嶺上ツモ和了チェック
                if (engine.canTsumo(currentSeat)) {
                  const winResult = engine.executeTsumo(currentSeat);
                  if (winResult) {
                    const yakuNames = winResult.yaku.map(([name, han]: [string, number]) => `${name}(${han}翻)`).join('・');
                    seqNo++;
                    queueAction({
                      game_id: gameId, hand_id: handId, seq_no: seqNo, actor_seat: currentSeat,
                      action_type: 'tsumo',
                      payload_json: { yaku: winResult.yaku, han: winResult.han, fu: winResult.fu, score_level: winResult.scoreLevel, score_changes: winResult.scoreChanges, rinshan: true },
                    }, {
                      summary_text: `嶺上開花！${yakuNames} ${winResult.han}翻${winResult.fu}符`,
                      detail_text: null,
                      structured_json: { candidates: [], risk: 'low', mode: 'push', target_yaku: winResult.yaku.map(([name]: [string, number]) => name) },
                      tokens_used: 0, model_name: 'engine',
                    });
                    handResult = { type: 'agari', winResult, scoreChanges: winResult.scoreChanges, dealerRetains: winResult.winnerSeat === engine.getDealerSeat() };
                    handOver = true;
                    break;
                  }
                }
              }
            }
          }

          // === 加槓チェック ===
          if (!handOver && engine.canKakan(currentSeat)) {
            const kakanCandidates = engine.getKakanCandidates(currentSeat);
            if (kakanCandidates.length > 0) {
              const kakanTile = kakanCandidates[0];
              const success = engine.executeKakan(currentSeat, kakanTile);
              if (success) {
                const kanMeld = engine.getState().players[currentSeat].melds.find((m: any) => m.type === 'kakan');
                seqNo++;
                queueAction({
                  game_id: gameId, hand_id: handId, seq_no: seqNo, actor_seat: currentSeat,
                  action_type: 'kan', payload_json: { kan_type: 'kakan', tile: kakanTile, tiles: kanMeld?.tiles || [] },
                }, {
                  summary_text: `${twin?.name || '???'}が${tileToName(kakanTile)}を加槓！`,
                  detail_text: null,
                  structured_json: { candidates: [], risk: 'low', mode: 'push', target_yaku: [], is_naki_decision: true },
                  tokens_used: 0, model_name: 'engine',
                });

                if (engine.canTsumo(currentSeat)) {
                  const winResult = engine.executeTsumo(currentSeat);
                  if (winResult) {
                    const yakuNames = winResult.yaku.map(([name, han]: [string, number]) => `${name}(${han}翻)`).join('・');
                    seqNo++;
                    queueAction({
                      game_id: gameId, hand_id: handId, seq_no: seqNo, actor_seat: currentSeat,
                      action_type: 'tsumo',
                      payload_json: { yaku: winResult.yaku, han: winResult.han, fu: winResult.fu, score_level: winResult.scoreLevel, score_changes: winResult.scoreChanges, rinshan: true },
                    }, {
                      summary_text: `嶺上開花！${yakuNames} ${winResult.han}翻${winResult.fu}符`,
                      detail_text: null,
                      structured_json: { candidates: [], risk: 'low', mode: 'push', target_yaku: winResult.yaku.map(([name]: [string, number]) => name) },
                      tokens_used: 0, model_name: 'engine',
                    });
                    handResult = { type: 'agari', winResult, scoreChanges: winResult.scoreChanges, dealerRetains: winResult.winnerSeat === engine.getDealerSeat() };
                    handOver = true;
                    break;
                  }
                }
              }
            }
          }
        }

        // === 打牌フェーズ ===
        if (engine.getState().phase === 'discard') {
          const updatedState = engine.getState();
          const candidates = engine.getDiscardCandidates(currentSeat);

          // リーチ判定
          const canRiichi = engine.canRiichi(currentSeat);
          const riichiCandidates = canRiichi ? engine.getRiichiDiscardCandidates(currentSeat) : [];

          // ヒューリスティック打牌
          const hResult = engine.chooseBestDiscardHeuristic(currentSeat);
          let chosenTile = hResult.tile;

          // リーチ候補を優先
          if (canRiichi && riichiCandidates.length > 0 && !riichiCandidates.includes(chosenTile)) {
            chosenTile = riichiCandidates[0];
          }

          // 思考テキスト生成
          const tileName = tileToName(chosenTile);
          const reasoning = buildHeuristicReasoning(
            twin, tileName, hResult.shanten, hResult.ukeireCount,
            updatedState, currentSeat,
          );

          // リーチ実行
          let isRiichi = false;
          if (canRiichi && riichiCandidates.some(rc => rc === chosenTile)) {
            engine.executeRiichi(currentSeat, chosenTile);
            isRiichi = true;
            seqNo++;
            queueAction({
              game_id: gameId, hand_id: handId, seq_no: seqNo, actor_seat: currentSeat,
              action_type: 'riichi', payload_json: { tile: chosenTile },
            });
          } else {
            engine.discard(chosenTile);
          }

          // 打牌アクション + 思考ログ
          seqNo++;
          queueAction({
            game_id: gameId, hand_id: handId, seq_no: seqNo, actor_seat: currentSeat,
            action_type: 'discard', payload_json: { tile: chosenTile },
          }, {
            summary_text: reasoning.summary,
            detail_text: reasoning.detail,
            structured_json: {
              risk: reasoning.risk, mode: reasoning.mode,
              candidates: [], target_yaku: [],
              shanten: hResult.shanten, ukeire_count: hResult.ukeireCount,
            },
            tokens_used: 0, model_name: 'heuristic',
          });

          // === 鳴き・ロンチェック ===
          const discardedTile = chosenTile;
          const discarderSeat = currentSeat;

          // ロンチェック
          const ronCandidates = engine.getRonCandidates(discardedTile, discarderSeat);
          if (ronCandidates.length > 0) {
            const ronSeat = ronCandidates[0];
            const winResult = engine.executeRon(ronSeat);
            if (winResult) {
              const yakuNames = winResult.yaku.map(([name, han]: [string, number]) => `${name}(${han}翻)`).join('・');
              seqNo++;
              queueAction({
                game_id: gameId, hand_id: handId, seq_no: seqNo, actor_seat: ronSeat,
                action_type: 'ron',
                payload_json: { tile: discardedTile, from_seat: discarderSeat, yaku: winResult.yaku, han: winResult.han, fu: winResult.fu, score_level: winResult.scoreLevel, score_changes: winResult.scoreChanges },
              }, {
                summary_text: `ロン！${yakuNames} ${winResult.han}翻${winResult.fu}符`,
                detail_text: `ロン牌: ${tileToName(discardedTile)} (${twins[discarderSeat]?.name}から)\n役: ${yakuNames}\n${winResult.han}翻${winResult.fu}符`,
                structured_json: { candidates: [], risk: 'low', mode: 'push', target_yaku: winResult.yaku.map(([name]: [string, number]) => name) },
                tokens_used: 0, model_name: 'engine',
              });
              handResult = { type: 'agari', winResult, scoreChanges: winResult.scoreChanges, dealerRetains: winResult.winnerSeat === engine.getDealerSeat() };
              handOver = true;
              break;
            }
          }

          // === 大明槓/ポン/チー（全てヒューリスティック） ===
          if (!handOver) {
            let called = false;

            // 大明槓
            const daiminkanCandidates = engine.getDaiminkanCandidates(discardedTile, discarderSeat);
            if (daiminkanCandidates.length > 0) {
              for (const kanSeat of daiminkanCandidates) {
                const kanTwin = twins[kanSeat];
                const nakiTendency = kanTwin?.style_params?.naki_tendency ?? 50;
                if (Math.random() * 100 < nakiTendency) {
                  const success = engine.executeDaiminkan(kanSeat, discardedTile);
                  if (success) {
                    const kanMeld = engine.getState().players[kanSeat].melds.slice(-1)[0];
                    seqNo++;
                    queueAction({
                      game_id: gameId, hand_id: handId, seq_no: seqNo, actor_seat: kanSeat,
                      action_type: 'kan',
                      payload_json: { kan_type: 'daiminkan', tile: discardedTile, tiles: kanMeld?.tiles || [], from_seat: discarderSeat },
                    }, {
                      summary_text: `${kanTwin?.name || '???'}が${tileToName(discardedTile)}を大明槓！`,
                      detail_text: null,
                      structured_json: { candidates: [], risk: 'medium', mode: 'push', target_yaku: [], is_naki_decision: true },
                      tokens_used: 0, model_name: 'engine',
                    });

                    if (engine.canTsumo(kanSeat)) {
                      const winResult = engine.executeTsumo(kanSeat);
                      if (winResult) {
                        const yakuNames = winResult.yaku.map(([name, han]: [string, number]) => `${name}(${han}翻)`).join('・');
                        seqNo++;
                        queueAction({
                          game_id: gameId, hand_id: handId, seq_no: seqNo, actor_seat: kanSeat,
                          action_type: 'tsumo',
                          payload_json: { yaku: winResult.yaku, han: winResult.han, fu: winResult.fu, score_level: winResult.scoreLevel, score_changes: winResult.scoreChanges, rinshan: true },
                        }, {
                          summary_text: `嶺上開花！${yakuNames} ${winResult.han}翻${winResult.fu}符`,
                          detail_text: null,
                          structured_json: { candidates: [], risk: 'low', mode: 'push', target_yaku: winResult.yaku.map(([name]: [string, number]) => name) },
                          tokens_used: 0, model_name: 'engine',
                        });
                        handResult = { type: 'agari', winResult, scoreChanges: winResult.scoreChanges, dealerRetains: winResult.winnerSeat === engine.getDealerSeat() };
                        handOver = true;
                      }
                    }
                    called = true;
                    break;
                  }
                }
              }
            }

            // ポン
            const ponCandidates = !called ? engine.getPonCandidates(discardedTile, discarderSeat) : [];
            if (ponCandidates.length > 0) {
              for (const ponSeat of ponCandidates) {
                const ponTwin = twins[ponSeat];
                const nakiTendency = ponTwin?.style_params?.naki_tendency ?? 50;
                if (Math.random() * 100 < nakiTendency) {
                  const success = engine.executePon(ponSeat, discardedTile);
                  if (success) {
                    const ponMeld = engine.getState().players[ponSeat].melds.slice(-1)[0];
                    seqNo++;
                    queueAction({
                      game_id: gameId, hand_id: handId, seq_no: seqNo, actor_seat: ponSeat,
                      action_type: 'pon',
                      payload_json: { tile: discardedTile, tiles: ponMeld?.tiles || [discardedTile], from_seat: discarderSeat },
                    }, {
                      summary_text: `${ponTwin?.name || '???'}が${tileToName(discardedTile)}をポン！面子完成。`,
                      detail_text: null,
                      structured_json: { candidates: [], risk: 'medium', mode: 'push', target_yaku: [], is_naki_decision: true },
                      tokens_used: 0, model_name: 'engine',
                    });
                    called = true;
                    break;
                  }
                }
              }
            }

            // チー
            if (!called) {
              const nextSeat = (discarderSeat + 1) % 4;
              if (engine.canChi(nextSeat, discardedTile)) {
                const chiTwin = twins[nextSeat];
                const nakiTendency = chiTwin?.style_params?.naki_tendency ?? 50;
                if (Math.random() * 100 < nakiTendency * 0.7) {
                  const chiOptions = engine.getChiOptions(nextSeat, discardedTile);
                  if (chiOptions.length > 0) {
                    const success = engine.executeChi(nextSeat, chiOptions[0]);
                    if (success) {
                      const chiMeld = engine.getState().players[nextSeat].melds.slice(-1)[0];
                      seqNo++;
                      queueAction({
                        game_id: gameId, hand_id: handId, seq_no: seqNo, actor_seat: nextSeat,
                        action_type: 'chi',
                        payload_json: { tile: discardedTile, tiles: chiMeld?.tiles || chiOptions[0], from_seat: discarderSeat },
                      }, {
                        summary_text: `${chiTwin?.name || '???'}が${tileToName(discardedTile)}をチー！順子完成。`,
                        detail_text: null,
                        structured_json: { candidates: [], risk: 'medium', mode: 'push', target_yaku: [], is_naki_decision: true },
                        tokens_used: 0, model_name: 'engine',
                      });
                      called = true;
                    }
                  }
                }
              }
            }

            if (!called) {
              engine.nextTurn();
            }
          }
        }
      }

      // === 局終了: バッファをフラッシュ ===
      await flushBatch();

      // 局結果を保存
      if (handResult) {
        await supabase
          .from('hands')
          .update({
            result_json: {
              type: handResult.type,
              winner_seat: handResult.winResult?.winnerSeat,
              loser_seat: handResult.winResult?.loserSeat,
              yaku: handResult.winResult?.yaku?.map(([name]: [string, number]) => name),
              han: handResult.winResult?.han,
              fu: handResult.winResult?.fu,
              score_changes: handResult.scoreChanges,
            },
          })
          .eq('id', handId);

        const dealerRetains = handResult.dealerRetains ?? false;
        if (!engine.advanceToNextHand(dealerRetains)) {
          break;
        }
      } else {
        break;
      }
    }

    // ゲーム終了前に残りをフラッシュ
    await flushBatch();

    // ゲーム終了
    const finalState = engine.getState();
    await supabase
      .from('games')
      .update({
        status: 'finished',
        finished_at: new Date().toISOString(),
        rule_set: {
          players: 4,
          format: 'tonpu',
          aka_dora: true,
          kuitan: true,
          atozuke: true,
          double_ron: false,
          tobi: true,
          open_hand: true,
          final_scores: finalState.players.map(p => p.score),
        },
      })
      .eq('id', gameId);

  } catch (error) {
    console.error('Game execution error:', error);
    // エラー時もバッファフラッシュ試行
    try { await flushBatch(); } catch {}
    await supabase
      .from('games')
      .update({ status: 'failed' })
      .eq('id', gameId);
    throw error;
  }
}
