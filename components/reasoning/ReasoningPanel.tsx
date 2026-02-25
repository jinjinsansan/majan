'use client';

import { useState } from 'react';
import type { Twin, Action, ReasoningLog } from '@/lib/types';

interface ReasoningPanelProps {
  twins: Twin[];
  reasonings: ReasoningLog[];
  actions: Action[];
}

export function ReasoningPanel({ twins, reasonings, actions }: ReasoningPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const seatNames = ['東', '南', '西', '北'];
  const seatColors = ['text-red-400', 'text-blue-400', 'text-green-400', 'text-yellow-400'];

  const toggleExpand = (id: string) => {
    const newSet = new Set(expandedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedIds(newSet);
  };

  // アクションと思考ログを結合
  const logsWithContext = actions.map(action => {
    const reasoning = reasonings.find(r => r.action_id === action.id);
    const twin = twins[action.actor_seat];
    return { action, reasoning, twin };
  }).filter(item => item.reasoning); // 思考ログがあるもののみ

  if (logsWithContext.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <p className="text-2xl mb-2">💭</p>
        <p className="text-sm">思考ログがまだありません</p>
        <p className="text-xs mt-2">対局が進むと、AIの思考がここに表示されます</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="font-semibold mb-4 flex items-center gap-2">
        💭 思考ログ
        <span className="text-xs text-muted-foreground font-normal">
          ({logsWithContext.length}件)
        </span>
      </h2>

      <div className="space-y-3">
        {logsWithContext.slice().reverse().map(({ action, reasoning, twin }) => {
          const isExpanded = expandedIds.has(reasoning!.id);
          const structured = reasoning!.structured_json;
          
          return (
            <div 
              key={reasoning!.id}
              className="bg-card rounded-lg border p-3"
            >
              {/* ヘッダー */}
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-sm font-semibold ${seatColors[action.actor_seat]}`}>
                  {seatNames[action.actor_seat]}
                </span>
                <span className="text-sm truncate">{twin?.name}</span>
                
                {/* リスク表示 */}
                {structured?.risk && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    structured.risk === 'high' ? 'bg-red-500/20 text-red-400' :
                    structured.risk === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-green-500/20 text-green-400'
                  }`}>
                    {structured.risk === 'high' ? '危険' :
                     structured.risk === 'medium' ? '注意' : '安全'}
                  </span>
                )}

                {/* モード表示 */}
                {structured?.mode && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    structured.mode === 'push' ? 'bg-red-500/10 text-red-300' :
                    structured.mode === 'pull' ? 'bg-blue-500/10 text-blue-300' :
                    'bg-gray-500/10 text-gray-300'
                  }`}>
                    {structured.mode === 'push' ? '押し' :
                     structured.mode === 'pull' ? '引き' : 'バランス'}
                  </span>
                )}
              </div>

              {/* 短文 */}
              <p className="text-sm leading-relaxed">
                {reasoning!.summary_text}
              </p>

              {/* 狙い役 */}
              {structured?.target_yaku && structured.target_yaku.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {structured.target_yaku.map((yaku, i) => (
                    <span 
                      key={i}
                      className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded"
                    >
                      {yaku}
                    </span>
                  ))}
                </div>
              )}

              {/* 詳細（折りたたみ） */}
              {reasoning!.detail_text && (
                <div className="mt-2">
                  <button
                    onClick={() => toggleExpand(reasoning!.id)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {isExpanded ? '▼ 詳細を閉じる' : '▶ 詳細を見る'}
                  </button>
                  
                  {isExpanded && (
                    <div className="mt-2 p-2 bg-muted/50 rounded text-xs leading-relaxed whitespace-pre-wrap">
                      {reasoning!.detail_text}
                    </div>
                  )}
                </div>
              )}

              {/* アクション情報 */}
              <div className="mt-2 text-xs text-muted-foreground">
                {action.action_type === 'discard' && (
                  <span>→ {action.payload_json?.tile} を切る</span>
                )}
                {action.action_type === 'riichi' && (
                  <span>→ リーチ宣言</span>
                )}
                {action.action_type === 'chi' && (
                  <span>→ チー</span>
                )}
                {action.action_type === 'pon' && (
                  <span>→ ポン</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
