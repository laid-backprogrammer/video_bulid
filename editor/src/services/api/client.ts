const API_BASE = '';

export type SseHandlers = Record<string, ((payload: any) => void) | undefined>;

export const fetchJson = async <T,>(url: string, opts?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_BASE}${url}`, opts);
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const preview = text.replace(/\s+/g, ' ').slice(0, 180);
      throw new Error(`接口 ${url} 返回的不是 JSON：${preview}`);
    }
  }
  if (!res.ok) {
    throw new Error(data?.error || data?.message || text || `${res.status} ${res.statusText}`);
  }
  return data as T;
};

export const postJson = <T,>(url: string, body: unknown = {}) =>
  fetchJson<T>(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });

export const postSse = async (url: string, body: unknown, handlers: SseHandlers) => {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (!res.body) throw new Error('浏览器不支持流式响应');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  let dataLines: string[] = [];

  const dispatch = () => {
    if (!dataLines.length) {
      eventName = 'message';
      return;
    }
    const payloadText = dataLines.join('\n');
    dataLines = [];
    const payload = payloadText ? JSON.parse(payloadText) : {};
    handlers[eventName]?.(payload);
    if (eventName === 'error') {
      throw new Error(payload.error || 'SSE stream failed');
    }
    eventName = 'message';
  };

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) {
        dispatch();
      } else if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  }
  if (buffer.trim()) {
    if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart());
    dispatch();
  }
};
