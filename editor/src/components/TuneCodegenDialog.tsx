import React, {useEffect, useMemo, useRef, useState} from 'react';
import {postSse} from '../services/api/client';

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type TuneCodegenDialogProps = {
  open: boolean;
  sceneId: string;
  sceneText: string;
  disabled?: boolean;
  onClose: () => void;
  onDone: (payload?: {config?: unknown; status?: unknown}) => void | Promise<void>;
};

type RunPhase = 'idle' | 'uploading' | 'analyzing' | 'codegen' | 'done' | 'failed';

export function TuneCodegenDialog({open, sceneId, sceneText, disabled = false, onClose, onDone}: TuneCodegenDialogProps) {
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceNotes, setReferenceNotes] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {role: 'system', content: '描述你在预览里看到的问题或想要的效果。我会结合文案、字幕时间轴、设计备注和当前素材，重新生成并校验 Remotion 场景代码。'},
  ]);
  const [logs, setLogs] = useState<string[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);

  const canSend = useMemo(() => Boolean(input.trim() && !running && !disabled), [disabled, input, running]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, logs, running]);

  if (!open) return null;

  const appendAssistant = (text: string) => {
    setMessages((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') {
        last.content = text;
        return next;
      }
      next.push({role: 'assistant', content: text});
      return next;
    });
  };

  const pushLog = (line: string) => {
    setLogs((current) => [...current, `[${new Date().toLocaleTimeString()}] ${line}`].slice(-160));
  };

  const uploadReference = async () => {
    if (!referenceFile) return null;
    setPhase('uploading');
    pushLog(`上传参考图：${referenceFile.name}`);
    const form = new FormData();
    form.append('sceneId', sceneId);
    form.append('role', 'reference');
    form.append('notes', referenceNotes.trim() || `微调对话参考图：${referenceFile.name}`);
    form.append('file', referenceFile);
    const response = await fetch('/api/scene/assets', {method: 'POST', body: form});
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(payload.error || text || response.statusText);
    pushLog(`参考图已加入 LLM 上下文：${payload.asset?.name ?? referenceFile.name}`);
    setReferenceFile(null);
    setReferenceNotes('');
    return payload;
  };

  const send = async () => {
    if (!canSend) return;
    const prompt = input.trim();
    const history = messages.filter((item) => item.role !== 'system');
    setInput('');
    setRunning(true);
    setPhase(referenceFile ? 'uploading' : 'analyzing');
    setLogs([]);
    setMessages((current) => [
      ...current,
      {role: 'user', content: referenceFile ? `${prompt}\n\n[参考图] ${referenceFile.name}` : prompt},
      {role: 'assistant', content: '收到。我会先读取当前时间轴、设计备注和参考素材，然后重新生成 Remotion 代码。'},
    ]);

    try {
      await uploadReference();
      setPhase('analyzing');
      pushLog('连接 OpenAI，分析微调要求和时间轴上下文');
      await postSse('/api/scene/tune-codegen/stream', {
        sceneId,
        prompt,
        text: sceneText,
        history,
      }, {
        status: (payload) => {
          setPhase('analyzing');
          pushLog(payload.message || 'LLM 已连接');
        },
        token: (payload) => appendAssistant(payload.text ?? ''),
        done: (payload) => appendAssistant(payload.text ?? ''),
        codegen_status: (payload) => {
          setPhase('codegen');
          pushLog(payload.status?.message || '开始生成 Remotion 代码');
        },
        codegen_log: (payload) => {
          setPhase('codegen');
          if (payload.line) pushLog(payload.line);
        },
        codegen_done: async (payload) => {
          setPhase('done');
          pushLog('代码已重新生成并通过校验');
          setMessages((current) => [...current, {role: 'system', content: 'Remotion 代码已按本轮对话重新生成，并已通过本地校验。请重新渲染本段预览查看效果。'}]);
          await onDone(payload);
        },
        error: (payload) => {
          setPhase('failed');
          pushLog(`失败：${payload.error || 'unknown error'}`);
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPhase('failed');
      pushLog(`执行失败：${message}`);
      setMessages((current) => [...current, {role: 'system', content: `执行失败：${message}`}]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={backdropStyle} onClick={onClose}>
      <section style={dialogStyle} onClick={(event) => event.stopPropagation()}>
        <header style={headerStyle}>
          <div>
            <div style={kickerStyle}>Remotion Tune Agent</div>
            <h2 style={titleStyle}>{sceneId} 预览微调对话</h2>
            <p style={subtitleStyle}>对话不会只生成建议，会驱动后端 OpenAI agent 重新生成场景 TSX。</p>
          </div>
          <button type="button" style={closeButtonStyle} onClick={onClose}>关闭</button>
        </header>

        <div style={phaseBarStyle}>
          {[
            ['uploading', '上传参考图'],
            ['analyzing', '分析要求'],
            ['codegen', '生成代码'],
            ['done', '完成'],
          ].map(([key, label]) => (
            <span key={key} style={phasePillStyle(phase, key as RunPhase)}>{label}</span>
          ))}
          {phase === 'failed' ? <span style={phaseFailedStyle}>失败</span> : null}
        </div>

        <div ref={bodyRef} style={bodyStyle}>
          {messages.map((item, index) => (
            <div key={`${index}-${item.role}`} style={messageRowStyle(item.role)}>
              <div style={bubbleStyle(item.role)}>
                <div style={labelStyle}>{item.role === 'user' ? '你' : item.role === 'assistant' ? 'OpenAI Agent' : '系统'}</div>
                <div style={textStyle}>{item.content || (running ? '正在组织修改方案...' : '')}</div>
              </div>
            </div>
          ))}
          {logs.length ? (
            <div style={logBoxStyle}>
              {logs.slice(-80).map((line, index) => <div key={index}>{line}</div>)}
            </div>
          ) : null}
        </div>

        <footer style={footerStyle}>
          <div style={composerStyle}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="例如：字幕挡住主体，开头太空，彩虹元素不够明显；按 0-2 秒先出现角色，2 秒后再放大标题。"
              style={inputStyle}
              disabled={running || disabled}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') send();
              }}
            />
            <div style={referenceRowStyle}>
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(event) => setReferenceFile(event.target.files?.[0] ?? null)}
                disabled={running || disabled}
                style={fileInputStyle}
              />
              <input
                value={referenceNotes}
                onChange={(event) => setReferenceNotes(event.target.value)}
                placeholder="参考图说明，例如：按这个构图和色彩微调"
                disabled={running || disabled}
                style={notesInputStyle}
              />
            </div>
            {referenceFile ? <div style={fileHintStyle}>将作为 reference 素材上传：{referenceFile.name}</div> : null}
          </div>
          <button type="button" style={sendButtonStyle(!canSend)} disabled={!canSend} onClick={send}>
            {running ? '正在生成 Remotion 代码...' : '发送并生成 Remotion 代码'}
          </button>
        </footer>
      </section>
    </div>
  );
}

const backdropStyle: React.CSSProperties = {position: 'fixed', inset: 0, zIndex: 35, display: 'grid', placeItems: 'center', background: 'rgba(2,6,14,0.72)', backdropFilter: 'blur(10px)'};
const dialogStyle: React.CSSProperties = {width: 'min(980px, 94vw)', height: 'min(820px, 92vh)', display: 'grid', gridTemplateRows: 'auto auto 1fr auto', overflow: 'hidden', borderRadius: 22, border: '1px solid rgba(139,233,253,0.22)', background: 'linear-gradient(160deg, #101729 0%, #07101c 70%, #091712 100%)', boxShadow: '0 30px 120px rgba(0,0,0,0.58)'};
const headerStyle: React.CSSProperties = {display: 'flex', justifyContent: 'space-between', gap: 18, padding: '18px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)'};
const kickerStyle: React.CSSProperties = {fontSize: 11, color: '#50fa7b', letterSpacing: 1.1, textTransform: 'uppercase', fontWeight: 900};
const titleStyle: React.CSSProperties = {margin: '4px 0 6px', fontSize: 22, color: '#f4fff8'};
const subtitleStyle: React.CSSProperties = {margin: 0, color: '#9fb3c8', fontSize: 12};
const bodyStyle: React.CSSProperties = {overflow: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12};
const messageRowStyle = (role: ChatMessage['role']): React.CSSProperties => ({display: 'flex', justifyContent: role === 'user' ? 'flex-end' : 'flex-start'});
const bubbleStyle = (role: ChatMessage['role']): React.CSSProperties => ({maxWidth: role === 'user' ? '72%' : '82%', borderRadius: role === 'user' ? '18px 18px 6px 18px' : '18px 18px 18px 6px', border: `1px solid ${role === 'user' ? 'rgba(139,233,253,0.32)' : role === 'assistant' ? 'rgba(80,250,123,0.30)' : 'rgba(255,255,255,0.10)'}`, background: role === 'user' ? 'rgba(139,233,253,0.10)' : role === 'assistant' ? 'rgba(80,250,123,0.10)' : 'rgba(255,255,255,0.045)', color: '#e6edf3', padding: '10px 12px'});
const labelStyle: React.CSSProperties = {fontSize: 11, color: '#9fb3c8', fontWeight: 900, marginBottom: 5};
const textStyle: React.CSSProperties = {whiteSpace: 'pre-wrap', lineHeight: 1.65, fontSize: 13};
const logBoxStyle: React.CSSProperties = {fontFamily: 'Consolas, monospace', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: '#c8dcff', background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 12};
const footerStyle: React.CSSProperties = {display: 'grid', gridTemplateColumns: '1fr 180px', gap: 10, padding: 14, borderTop: '1px solid rgba(255,255,255,0.08)'};
const composerStyle: React.CSSProperties = {display: 'grid', gap: 8};
const inputStyle: React.CSSProperties = {minHeight: 72, resize: 'vertical', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: '#060a13', color: '#e6edf3', padding: 10, lineHeight: 1.5};
const referenceRowStyle: React.CSSProperties = {display: 'grid', gridTemplateColumns: 'minmax(180px, 0.55fr) 1fr', gap: 8};
const fileInputStyle: React.CSSProperties = {minWidth: 0, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: '#060a13', color: '#c8dcff', padding: '7px 9px', fontSize: 12};
const notesInputStyle: React.CSSProperties = {minWidth: 0, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: '#060a13', color: '#e6edf3', padding: '8px 10px', fontSize: 12};
const fileHintStyle: React.CSSProperties = {fontSize: 12, color: '#8be9fd'};
const sendButtonStyle = (disabled: boolean): React.CSSProperties => ({alignSelf: 'stretch', border: `1px solid ${disabled ? 'rgba(255,255,255,0.12)' : 'rgba(80,250,123,0.46)'}`, background: disabled ? 'rgba(255,255,255,0.05)' : 'rgba(80,250,123,0.14)', color: disabled ? '#6f8098' : '#50fa7b', borderRadius: 12, padding: '0 14px', cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 900});
const closeButtonStyle: React.CSSProperties = {height: 36, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#e6edf3', borderRadius: 10, padding: '8px 10px', cursor: 'pointer', fontWeight: 800};
const phaseBarStyle: React.CSSProperties = {display: 'flex', gap: 8, alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.16)'};
const phaseOrder: RunPhase[] = ['idle', 'uploading', 'analyzing', 'codegen', 'done'];
const phasePillStyle = (phase: RunPhase, key: RunPhase): React.CSSProperties => {
  const active = phase === key;
  const passed = phaseOrder.indexOf(phase) > phaseOrder.indexOf(key);
  const color = active || passed ? '#50fa7b' : '#6f8098';
  return {fontSize: 12, color, border: `1px solid ${active ? 'rgba(80,250,123,0.5)' : 'rgba(255,255,255,0.10)'}`, background: active ? 'rgba(80,250,123,0.12)' : 'rgba(255,255,255,0.04)', borderRadius: 999, padding: '5px 9px', fontWeight: 800};
};
const phaseFailedStyle: React.CSSProperties = {fontSize: 12, color: '#ffb4b4', border: '1px solid rgba(255,107,107,0.35)', background: 'rgba(255,107,107,0.10)', borderRadius: 999, padding: '5px 9px', fontWeight: 800};
