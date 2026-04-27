import {useEffect, useState} from 'react';
import type {CSSProperties} from 'react';
import type {SceneItem} from '../../types';

const emptyStyle: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  minHeight: 160,
  color: '#9fb3c8',
  textAlign: 'center',
  fontSize: 13,
};
const hintStyle: CSSProperties = {color: '#9fb3c8', fontSize: 13};

const formatDuration = (ms: number | null) => {
  if (!ms) return '未生成';
  return `${(ms / 1000).toFixed(1)}s`;
};

export function CaptionTimeline({scene}: {scene: SceneItem}) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    if (!scene.captionsUrl) return;
    fetch(`${scene.captionsUrl}?t=${Date.now()}`)
      .then((response) => response.json())
      .then(setData)
      .catch(() => {});
  }, [scene.captionsUrl]);

  if (!data?.cues?.length) return <div style={emptyStyle}>加载时间轴数据中...</div>;

  const totalFrames = data.durationInFrames || data.cues[data.cues.length - 1]?.endFrame || 1;

  return (
    <div style={{overflowX: 'auto'}}>
      <div style={{display: 'flex', flexDirection: 'column', gap: 6, minWidth: 600}}>
        {data.cues.map((cue: any) => {
          const left = (cue.startFrame / totalFrames) * 100;
          const width = ((cue.endFrame - cue.startFrame) / totalFrames) * 100;
          return (
            <div key={cue.id} style={{display: 'flex', alignItems: 'center', gap: 8}}>
              <div style={{width: 60, fontSize: 11, color: '#9fb3c8', flexShrink: 0, textAlign: 'right'}}>
                {(cue.startFrame / 30).toFixed(1)}s
              </div>
              <div style={{flex: 1, position: 'relative', height: 28, background: 'rgba(255,255,255,0.04)', borderRadius: 6}}>
                <div
                  style={{
                    position: 'absolute',
                    left: `${left}%`,
                    width: `${Math.max(width, 0.5)}%`,
                    top: 4,
                    bottom: 4,
                    background: 'rgba(139,233,253,0.25)',
                    borderRadius: 4,
                    border: '1px solid rgba(139,233,253,0.4)',
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    left: `${left}%`,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    paddingLeft: 6,
                    fontSize: 12,
                    color: '#e6edf3',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '90%',
                  }}
                >
                  {cue.text}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <p style={{...hintStyle, marginTop: 8}}>
        共 {data.cues.length} 个片段 · {data.wordCount ?? data.cues.reduce((sum: number, cue: any) => sum + (cue.words?.length ?? 0), 0)} 个词/字 ·
        总时长 {formatDuration(Math.round((totalFrames / 30) * 1000))}
        {data.alignmentSource ? ` · ${data.alignmentSource === 'asr' ? 'ASR' : '估算'}对齐` : ''}
      </p>
    </div>
  );
}
