import type {CSSProperties} from 'react';
import type {AgentStoryboardDraft} from '../types';

export function StoryboardDraftPanel({
  draft,
  disabled,
  onChange,
  onApply,
}: {
  draft: AgentStoryboardDraft | null;
  disabled: boolean;
  onChange: (draft: AgentStoryboardDraft) => void;
  onApply: () => void;
}) {
  if (!draft) {
    return <div style={emptyStyle}>还没有分镜草案。输入文章或方向后，Agent 会先生成可编辑分镜。</div>;
  }

  const updateScene = (index: number, patch: Partial<AgentStoryboardDraft['scenes'][number]>) => {
    onChange({
      ...draft,
      scenes: draft.scenes.map((scene, sceneIndex) => (
        sceneIndex === index ? {...scene, ...patch} : scene
      )),
    });
  };

  const removeScene = (index: number) => {
    onChange({...draft, scenes: draft.scenes.filter((_, sceneIndex) => sceneIndex !== index)});
  };

  const addScene = () => {
    onChange({
      ...draft,
      scenes: [...draft.scenes, {text: '', designNotes: '', durationHintSec: 6}],
    });
  };

  return (
    <div style={wrapStyle}>
      <label style={labelStyle}>
        标题
        <input
          value={draft.title}
          disabled={disabled}
          onChange={(event) => onChange({...draft, title: event.target.value})}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        摘要
        <textarea
          value={draft.summary}
          disabled={disabled}
          onChange={(event) => onChange({...draft, summary: event.target.value})}
          style={textareaStyle}
        />
      </label>
      <div style={sceneListStyle}>
        {draft.scenes.map((scene, index) => (
          <article key={`${index}-${scene.id ?? 'scene'}`} style={sceneCardStyle}>
            <div style={sceneHeaderStyle}>
              <strong>Scene {index + 1}</strong>
              <button type="button" style={miniButtonStyle} disabled={disabled} onClick={() => removeScene(index)}>
                移除
              </button>
            </div>
            <textarea
              value={scene.text}
              disabled={disabled}
              placeholder="这一段的旁白文案"
              onChange={(event) => updateScene(index, {text: event.target.value})}
              style={textareaStyle}
            />
            <textarea
              value={scene.designNotes ?? ''}
              disabled={disabled}
              placeholder="视觉方案 / 素材使用 / 风格要求"
              onChange={(event) => updateScene(index, {designNotes: event.target.value})}
              style={textareaStyle}
            />
            <label style={smallLabelStyle}>
              建议时长（秒）
              <input
                type="number"
                min={2}
                max={30}
                value={scene.durationHintSec ?? 6}
                disabled={disabled}
                onChange={(event) => updateScene(index, {durationHintSec: Number(event.target.value) || 6})}
                style={numberInputStyle}
              />
            </label>
          </article>
        ))}
      </div>
      <div style={actionsStyle}>
        <button type="button" style={secondaryButtonStyle} disabled={disabled} onClick={addScene}>
          增加场景
        </button>
        <button type="button" style={primaryButtonStyle} disabled={disabled || draft.scenes.every((scene) => !scene.text.trim())} onClick={onApply}>
          应用到项目
        </button>
      </div>
    </div>
  );
}

const wrapStyle: CSSProperties = {display: 'grid', gap: 12, padding: 14};
const emptyStyle: CSSProperties = {minHeight: 180, display: 'grid', placeItems: 'center', color: '#8c8c8c', textAlign: 'center', padding: 20};
const labelStyle: CSSProperties = {display: 'grid', gap: 6, color: '#bdbdbd', fontSize: 12, fontWeight: 700};
const smallLabelStyle: CSSProperties = {display: 'grid', gridTemplateColumns: '1fr 90px', alignItems: 'center', gap: 8, color: '#a8a8a8', fontSize: 12};
const inputStyle: CSSProperties = {border: '1px solid rgba(255,255,255,0.12)', background: '#101010', color: '#f0f0f0', borderRadius: 10, padding: 10};
const textareaStyle: CSSProperties = {minHeight: 76, border: '1px solid rgba(255,255,255,0.12)', background: '#101010', color: '#f0f0f0', borderRadius: 10, padding: 10, lineHeight: 1.55, resize: 'vertical'};
const numberInputStyle: CSSProperties = {...inputStyle, padding: 8};
const sceneListStyle: CSSProperties = {display: 'grid', gap: 10};
const sceneCardStyle: CSSProperties = {display: 'grid', gap: 8, border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: 10, background: '#202020'};
const sceneHeaderStyle: CSSProperties = {display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8};
const actionsStyle: CSSProperties = {display: 'flex', justifyContent: 'space-between', gap: 10};
const miniButtonStyle: CSSProperties = {border: '1px solid rgba(255,107,107,0.28)', background: 'rgba(255,107,107,0.10)', color: '#ff9999', borderRadius: 8, padding: '6px 9px', cursor: 'pointer'};
const secondaryButtonStyle: CSSProperties = {border: '1px solid rgba(255,255,255,0.12)', background: '#222', color: '#ddd', borderRadius: 999, padding: '9px 12px', cursor: 'pointer', fontWeight: 800};
const primaryButtonStyle: CSSProperties = {border: 0, background: '#f2f2f2', color: '#111', borderRadius: 999, padding: '9px 14px', cursor: 'pointer', fontWeight: 900};

