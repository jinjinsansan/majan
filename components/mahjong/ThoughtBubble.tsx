'use client';

import type { ReasoningLog } from '@/lib/types';

interface ThoughtBubbleProps {
  reasoning: ReasoningLog;
  seatColor: string;
  compact?: boolean;
}

export function ThoughtBubble({ reasoning, seatColor, compact = false }: ThoughtBubbleProps) {
  const structured = reasoning.structured_json;

  // リスクに応じた背景色
  const riskBg = structured?.risk === 'high'
    ? 'border-red-500/30 bg-red-950/20'
    : structured?.risk === 'medium'
    ? 'border-yellow-500/30 bg-yellow-950/20'
    : 'border-primary/20 bg-card/95';

  return (
    <div className={`thought-bubble ${riskBg} animate-bubble-in ${compact ? 'p-2' : 'p-3'}`}>
      {/* バッジ行 */}
      <div className="flex items-center gap-1 mb-1 flex-wrap">
        {structured?.risk && (
          <span className={`text-[9px] sm:text-[10px] px-1 py-0.5 rounded font-medium ${
            structured.risk === 'high' ? 'bg-red-500/20 text-red-400' :
            structured.risk === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-green-500/20 text-green-400'
          }`}>
            {structured.risk === 'high' ? '危険' :
             structured.risk === 'medium' ? '注意' : '安全'}
          </span>
        )}

        {structured?.mode && (
          <span className={`text-[9px] sm:text-[10px] px-1 py-0.5 rounded font-medium ${
            structured.mode === 'push' ? 'bg-red-500/10 text-red-300' :
            structured.mode === 'pull' ? 'bg-blue-500/10 text-blue-300' :
            'bg-gray-500/10 text-gray-300'
          }`}>
            {structured.mode === 'push' ? '攻' :
             structured.mode === 'pull' ? '守' : '均'}
          </span>
        )}

        {structured?.target_yaku && structured.target_yaku.length > 0 && (
          <>
            {structured.target_yaku.slice(0, 2).map((yaku: string, i: number) => (
              <span
                key={i}
                className="text-[9px] sm:text-[10px] bg-primary/20 text-primary px-1 py-0.5 rounded"
              >
                {yaku}
              </span>
            ))}
          </>
        )}
      </div>

      {/* 思考テキスト */}
      <p className={`${compact ? 'text-[10px] sm:text-xs' : 'text-xs sm:text-sm'} leading-relaxed ${seatColor}`}>
        {reasoning.summary_text}
      </p>

      {/* 詳細テキスト */}
      {reasoning.detail_text && !compact && (
        <div className="mt-1.5 p-1.5 bg-muted/30 rounded text-[10px] sm:text-xs leading-relaxed whitespace-pre-wrap border-l-2 border-primary/30 text-muted-foreground max-h-24 overflow-y-auto">
          {reasoning.detail_text}
        </div>
      )}
    </div>
  );
}
