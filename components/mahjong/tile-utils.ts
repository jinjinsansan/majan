// 牌を表示用テキストに変換
export function tileToDisplay(tile: string): { text: string; isRed: boolean; isHonor: boolean } {
  if (!tile || tile.length < 2) return { text: '?', isRed: false, isHonor: false };

  const suitChar = tile.slice(-1);
  const numStr = tile.slice(0, -1);

  // 字牌
  if (suitChar === 'z') {
    const honors: Record<string, string> = {
      '1': '東', '2': '南', '3': '西', '4': '北',
      '5': '白', '6': '發', '7': '中'
    };
    return { text: honors[numStr] || '?', isRed: false, isHonor: true };
  }

  // 数牌
  const suitNames: Record<string, string> = { 'm': '萬', 'p': '筒', 's': '索' };
  const suitName = suitNames[suitChar] || '?';

  // 赤ドラ（0 = 赤5）
  if (numStr === '0') {
    return { text: '5' + suitName, isRed: true, isHonor: false };
  }

  return { text: numStr + suitName, isRed: false, isHonor: false };
}
