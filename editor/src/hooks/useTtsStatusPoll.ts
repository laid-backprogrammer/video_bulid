import {useCallback, useEffect, useRef} from 'react';
import {getErrorMessage} from '../app/workflow';
import {fetchJson} from '../services/api/client';
import type {TtsStatus} from '../types';

type UseTtsStatusPollOptions = {
  setTtsStatus: React.Dispatch<React.SetStateAction<TtsStatus | null>>;
  refresh: () => Promise<void>;
  pushLog: (line: string) => void;
};

export function useTtsStatusPoll({setTtsStatus, refresh, pushLog}: UseTtsStatusPollOptions) {
  const ttsPollErrorRef = useRef<string | null>(null);

  const noteTtsStatusError = useCallback((error: unknown) => {
    const message = getErrorMessage(error);
    const isNew = ttsPollErrorRef.current !== message;
    if (isNew) {
      pushLog(`语音状态刷新失败：${message}`);
      ttsPollErrorRef.current = message;
    }
    setTtsStatus((current) => ({
      running: false,
      mode: current?.mode ?? null,
      sceneId: current?.sceneId ?? null,
      currentSceneId: current?.currentSceneId ?? null,
      currentIndex: current?.currentIndex ?? 0,
      total: current?.total ?? 0,
      done: current?.done ?? 0,
      step: 'failed',
      message: '语音状态刷新失败',
      taskId: current?.taskId ?? null,
      providerStatus: current?.providerStatus ?? null,
      outputFile: current?.outputFile ?? null,
      startedAt: current?.startedAt ?? null,
      endTime: Date.now(),
      error: message,
      logs: isNew ? [...(current?.logs ?? []), `[${new Date().toLocaleTimeString()}] 语音状态刷新失败：${message}`].slice(-120) : (current?.logs ?? []),
    }));
  }, [pushLog, setTtsStatus]);

  useEffect(() => {
    let wasRunning = false;
    const poll = async () => {
      try {
        const status = await fetchJson<TtsStatus>('/api/tts/status');
        setTtsStatus(status);
        if (ttsPollErrorRef.current) {
          pushLog('语音状态刷新已恢复');
          ttsPollErrorRef.current = null;
        }
        if (status.running || wasRunning) {
          await refresh();
        }
        wasRunning = status.running;
      } catch (error) {
        wasRunning = false;
        noteTtsStatusError(error);
      }
    };
    poll();
    const timer = setInterval(poll, 1000);
    return () => clearInterval(timer);
  }, [noteTtsStatusError, pushLog, refresh, setTtsStatus]);
}
