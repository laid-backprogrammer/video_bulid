import {useMemo, useState} from 'react';
import type {CSSProperties} from 'react';
import {ActionCard} from './ActionCard';
import {getOverallReadiness, getRunStateText} from '../state';
import type {AgentAction, AgentMessage, CodegenStatus, PipelineStatus, RenderStatus, SceneItem, TtsStatus} from '../types';

export function AgentPanel({
  scenes,
  selectedScene,
  messages,
  actions,
  running,
  actionRunning,
  tts,
  codegen,
  render,
  pipeline,
  logs,
  onAsk,
  onRunAction,
}: {
  scenes: SceneItem[];
  selectedScene: SceneItem | null;
  messages: AgentMessage[];
  actions: AgentAction[];
  running: boolean;
  actionRunning: string | null;
  tts: TtsStatus | null;
  codegen: CodegenStatus | null;
  render: RenderStatus | null;
  pipeline: PipelineStatus | null;
  logs: string[];
  onAsk: (message: string) => void;
  onRunAction: (action: AgentAction) => void;
}) {
  const [input, setInput] = useState('');
  const overall = getOverallReadiness(scenes);
  const runState = getRunStateText(tts, codegen, render, pipeline);
  const canAsk = Boolean(input.trim() && !running);
  const quickPrompt = useMemo(() => {
    if (!selectedScene) return '请检查当前项目状态，告诉我下一步怎么完成视频。';
    return `请围绕 ${selectedScene.id} 检查当前项目状态，给出完成视频的下一步计划。`;
  }, [selectedScene]);

  const send = (text: string) => {
    const next = text.trim();
    if (!next || running) return;
    setInput('');
    onAsk(next);
  };

  return (
    <aside style={wrapStyle}>
      <header style={headerStyle}>
        <span style={kickerStyle}>LLM Agent</span>
        <h2 style={titleStyle}>制作指挥台</h2>
        <p style={mutedStyle}>
          目标：完成当前视频 · 就绪率 {overall.percent}% · {runState}
        </p>
      </header>

      <section style={messagesStyle}>
        {messages.map((message) => (
          <article key={message.id} style={messageRowStyle(message.role)}>
            <span style={messageLabelStyle}>{message.role === 'user' ? '你' : message.role === 'agent' ? 'Agent' : '系统'}</span>
            <div style={messageBubbleStyle(message.role)}>{message.content || (running ? '正在分析...' : '')}</div>
          </article>
        ))}
        {running ? <div style={thinkingStyle}>Agent 正在读取项目状态并生成计划...</div> : null}
      </section>

      <section style={composerStyle}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="例如：帮我检查当前视频还差什么；或者：先把 scene1 做到可预览并给我微调建议。"
          style={inputStyle}
          disabled={running}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') send(input);
          }}
        />
        <div style={composerActionsStyle}>
          <button type="button" style={ghostButtonStyle(running)} disabled={running} onClick={() => send(quickPrompt)}>
            让 Agent 检查
          </button>
          <button type="button" style={sendButtonStyle(!canAsk)} disabled={!canAsk} onClick={() => send(input)}>
            发送
          </button>
        </div>
      </section>

      <section style={actionsStyle}>
        <div style={sectionTitleStyle}>
          <strong>可确认动作</strong>
          <span>{actions.length ? `${actions.length} 个建议` : '等待 Agent 建议'}</span>
        </div>
        {actions.length ? actions.map((action) => (
          <ActionCard
            key={action.id}
            action={action}
            disabled={running || Boolean(actionRunning)}
            running={actionRunning === action.id}
            onRun={onRunAction}
          />
        )) : (
          <div style={emptyStyle}>点击“让 Agent 检查”，它会给出可执行按钮。</div>
        )}
      </section>

      <section style={logStyle}>
        <div style={sectionTitleStyle}>
          <strong>运行日志</strong>
          <span>{logs.length ? '最近操作' : '暂无'}</span>
        </div>
        <div style={logBoxStyle}>
          {logs.slice(-80).map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}
        </div>
      </section>
    </aside>
  );
}

const wrapStyle: CSSProperties = {
  minWidth: 0,
  height: '100%',
  display: 'grid',
  gridTemplateRows: 'auto minmax(160px, 1fr) auto auto minmax(120px, 0.5fr)',
  gap: 12,
  overflow: 'hidden',
  borderLeft: '1px solid rgba(255,255,255,0.08)',
  background: '#081218',
  padding: 16,
};
const headerStyle: CSSProperties = {display: 'grid', gap: 4};
const kickerStyle: CSSProperties = {fontSize: 11, color: '#ffb703', fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.8};
const titleStyle: CSSProperties = {margin: 0, fontSize: 21, color: '#f7fbff', letterSpacing: 0};
const mutedStyle: CSSProperties = {margin: 0, color: '#8ea3bb', fontSize: 12, lineHeight: 1.45};
const messagesStyle: CSSProperties = {overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 9, paddingRight: 2};
const messageRowStyle = (role: AgentMessage['role']): CSSProperties => ({
  display: 'grid',
  justifyItems: role === 'user' ? 'end' : 'start',
  gap: 4,
});
const messageLabelStyle: CSSProperties = {fontSize: 11, color: '#8ea3bb', fontWeight: 800};
const messageBubbleStyle = (role: AgentMessage['role']): CSSProperties => ({
  maxWidth: role === 'user' ? '86%' : '94%',
  whiteSpace: 'pre-wrap',
  border: `1px solid ${role === 'user' ? 'rgba(76,201,240,0.32)' : role === 'agent' ? 'rgba(46,196,182,0.28)' : 'rgba(255,255,255,0.10)'}`,
  background: role === 'user' ? 'rgba(76,201,240,0.10)' : role === 'agent' ? 'rgba(46,196,182,0.09)' : 'rgba(255,255,255,0.045)',
  color: '#e6edf3',
  borderRadius: 8,
  padding: '9px 10px',
  lineHeight: 1.55,
  fontSize: 13,
});
const thinkingStyle: CSSProperties = {color: '#7bdff2', fontSize: 12};
const composerStyle: CSSProperties = {display: 'grid', gap: 8};
const inputStyle: CSSProperties = {
  minHeight: 82,
  resize: 'vertical',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: '#050b10',
  color: '#e6edf3',
  padding: 10,
  lineHeight: 1.5,
};
const composerActionsStyle: CSSProperties = {display: 'flex', justifyContent: 'space-between', gap: 8};
const ghostButtonStyle = (disabled: boolean): CSSProperties => ({
  border: '1px solid rgba(255,255,255,0.12)',
  background: disabled ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.07)',
  color: disabled ? '#6f8098' : '#d9e8f7',
  borderRadius: 8,
  padding: '8px 10px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontWeight: 800,
});
const sendButtonStyle = (disabled: boolean): CSSProperties => ({
  border: `1px solid ${disabled ? 'rgba(255,255,255,0.12)' : 'rgba(46,196,182,0.60)'}`,
  background: disabled ? 'rgba(255,255,255,0.04)' : 'rgba(46,196,182,0.16)',
  color: disabled ? '#6f8098' : '#2ec4b6',
  borderRadius: 8,
  padding: '8px 12px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontWeight: 900,
});
const actionsStyle: CSSProperties = {display: 'grid', gap: 8, minHeight: 0, overflow: 'auto'};
const logStyle: CSSProperties = {display: 'grid', gridTemplateRows: 'auto 1fr', gap: 8, minHeight: 0, overflow: 'hidden'};
const sectionTitleStyle: CSSProperties = {display: 'flex', justifyContent: 'space-between', color: '#d9e8f7', fontSize: 12};
const emptyStyle: CSSProperties = {border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, minHeight: 64, display: 'grid', placeItems: 'center', color: '#8ea3bb', fontSize: 12, textAlign: 'center'};
const logBoxStyle: CSSProperties = {overflow: 'auto', borderRadius: 8, background: '#03080d', color: '#9fb3c8', fontSize: 11, lineHeight: 1.5, padding: 10, fontFamily: 'Consolas, monospace', whiteSpace: 'pre-wrap'};

