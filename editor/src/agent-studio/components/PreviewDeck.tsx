import type {CSSProperties} from 'react';
import {Player} from '@remotion/player';
import {PreviewScene} from '../../../../src/Root';
import {formatDuration, getSceneReadiness} from '../state';
import type {RenderStatus, SceneItem} from '../types';

export function PreviewDeck({
  scene,
  fps,
  render,
  cacheKey,
  disabled = false,
  onRenderPreview,
  onOpenTune,
}: {
  scene: SceneItem | null;
  fps: number;
  render: RenderStatus | null;
  cacheKey: number;
  disabled?: boolean;
  onRenderPreview: (sceneId: string) => void;
  onOpenTune: () => void;
}) {
  if (!scene) {
    return <main style={wrapStyle}><div style={emptyStyle}>请选择一个场景</div></main>;
  }

  const readiness = getSceneReadiness(scene);
  const durationInFrames = Math.max(1, Math.ceil(scene.durationInFrames ?? ((scene.durationMs ?? 4000) / 1000) * fps));
  const liveScene = {
    id: scene.id,
    text: scene.text,
    enabled: scene.enabled,
    audioFile: scene.audioFile ?? '',
    captionsFile: scene.captionsFile ?? '',
    durationInFrames,
    cues: scene.cues ?? [],
    assets: scene.assets ?? [],
  };
  const previewVideo = render?.sceneId === scene.id && render.videoExists
    ? render.videoUrl
    : render?.previewVideos?.[scene.id]?.videoUrl ?? null;

  return (
    <main style={wrapStyle}>
      <header style={headerStyle}>
        <div>
          <span style={kickerStyle}>Current Scene</span>
          <h2 style={titleStyle}>{scene.id} · {readiness.nextAction}</h2>
          <p style={mutedStyle}>
            {formatDuration(scene.durationMs)} · {scene.cues?.length ?? 0} 个字幕片段 · {scene.assets?.length ?? 0} 个素材
          </p>
        </div>
        <div style={headerActionsStyle}>
          <button
            type="button"
            style={buttonStyle('#4cc9f0', disabled || !readiness.readyForPreview || Boolean(render?.running))}
            disabled={disabled || !readiness.readyForPreview || Boolean(render?.running)}
            onClick={() => onRenderPreview(scene.id)}
          >
            渲染本段预览
          </button>
          <button type="button" style={buttonStyle('#2ec4b6', false)} onClick={onOpenTune}>
            打开微调
          </button>
        </div>
      </header>

      <section style={previewSurfaceStyle}>
        {readiness.readyForPreview ? (
          <Player
            key={`${scene.id}-${cacheKey}-${durationInFrames}`}
            component={PreviewScene}
            inputProps={{sceneId: liveScene.id, scenes: [liveScene], fps}}
            durationInFrames={durationInFrames}
            compositionWidth={1920}
            compositionHeight={1080}
            fps={fps}
            controls
            style={playerStyle}
          />
        ) : (
          <div style={emptyStyle}>
            {readiness.blockers.slice(0, 3).join(' / ') || '当前场景暂不可预览'}
          </div>
        )}
      </section>

      <section style={lowerGridStyle}>
        <div style={panelStyle}>
          <div style={panelHeadStyle}>
            <strong>语音试听</strong>
            <span>{scene.audioExists ? '已生成' : '未生成'}</span>
          </div>
          {scene.audioExists && scene.audioUrl ? (
            <audio key={`${scene.id}-${cacheKey}`} controls src={`${scene.audioUrl}?t=${cacheKey}`} style={{width: '100%'}} />
          ) : (
            <div style={miniEmptyStyle}>等待 TTS 输出</div>
          )}
        </div>

        <div style={panelStyle}>
          <div style={panelHeadStyle}>
            <strong>字幕时间轴</strong>
            <span>{scene.captionExists ? `${scene.cues?.length ?? 0} cues` : '未对齐'}</span>
          </div>
          {scene.cues?.length ? (
            <div style={timelineStyle}>
              {scene.cues.slice(0, 12).map((cue) => {
                const left = (cue.startFrame / durationInFrames) * 100;
                const width = ((cue.endFrame - cue.startFrame) / durationInFrames) * 100;
                return (
                  <div key={cue.id} style={cueRowStyle}>
                    <span style={cueTimeStyle}>{(cue.startFrame / fps).toFixed(1)}s</span>
                    <div style={cueTrackStyle}>
                      <span style={{...cueFillStyle, left: `${left}%`, width: `${Math.max(width, 1)}%`}} />
                      <span style={cueTextStyle}>{cue.text}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={miniEmptyStyle}>等待 ASR 时间轴</div>
          )}
        </div>
      </section>

      <section style={panelStyle}>
        <div style={panelHeadStyle}>
          <strong>本段 MP4</strong>
          <span>{previewVideo ? '可播放' : '未渲染'}</span>
        </div>
        {previewVideo ? (
          <video key={previewVideo} controls src={previewVideo} style={videoStyle} />
        ) : (
          <div style={miniEmptyStyle}>渲染本段预览后会出现在这里</div>
        )}
      </section>
    </main>
  );
}

const wrapStyle: CSSProperties = {minWidth: 0, height: '100%', overflow: 'auto', padding: 18, background: '#0b111c'};
const headerStyle: CSSProperties = {display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14};
const headerActionsStyle: CSSProperties = {display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end'};
const kickerStyle: CSSProperties = {fontSize: 11, color: '#2ec4b6', fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.8};
const titleStyle: CSSProperties = {margin: '3px 0 4px', fontSize: 20, color: '#f7fbff', letterSpacing: 0};
const mutedStyle: CSSProperties = {margin: 0, color: '#8ea3bb', fontSize: 12};
const previewSurfaceStyle: CSSProperties = {background: '#02050b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden', marginBottom: 12};
const playerStyle: CSSProperties = {width: '100%', aspectRatio: '16 / 9', background: '#000'};
const lowerGridStyle: CSSProperties = {display: 'grid', gridTemplateColumns: 'minmax(220px, 0.7fr) 1fr', gap: 12, marginBottom: 12};
const panelStyle: CSSProperties = {border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.035)', borderRadius: 8, padding: 12};
const panelHeadStyle: CSSProperties = {display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10, color: '#e6edf3', fontSize: 13};
const timelineStyle: CSSProperties = {display: 'grid', gap: 6, maxHeight: 190, overflow: 'auto'};
const cueRowStyle: CSSProperties = {display: 'grid', gridTemplateColumns: '48px 1fr', gap: 8, alignItems: 'center'};
const cueTimeStyle: CSSProperties = {fontSize: 11, color: '#8ea3bb', textAlign: 'right'};
const cueTrackStyle: CSSProperties = {position: 'relative', height: 24, borderRadius: 6, background: 'rgba(255,255,255,0.06)', overflow: 'hidden'};
const cueFillStyle: CSSProperties = {position: 'absolute', top: 4, bottom: 4, borderRadius: 4, background: 'rgba(76,201,240,0.30)', border: '1px solid rgba(76,201,240,0.44)'};
const cueTextStyle: CSSProperties = {position: 'absolute', inset: '4px 7px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11, color: '#d9e8f7'};
const videoStyle: CSSProperties = {width: '100%', maxHeight: 300, background: '#000', borderRadius: 6};
const emptyStyle: CSSProperties = {minHeight: 280, display: 'grid', placeItems: 'center', color: '#8ea3bb', textAlign: 'center', fontSize: 13, padding: 20};
const miniEmptyStyle: CSSProperties = {minHeight: 58, display: 'grid', placeItems: 'center', color: '#8ea3bb', fontSize: 12, textAlign: 'center'};

const buttonStyle = (color: string, disabled: boolean): CSSProperties => ({
  border: `1px solid ${disabled ? 'rgba(255,255,255,0.12)' : `${color}66`}`,
  background: disabled ? 'rgba(255,255,255,0.05)' : `${color}18`,
  color: disabled ? '#6f8098' : color,
  borderRadius: 8,
  padding: '9px 11px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontWeight: 800,
});
