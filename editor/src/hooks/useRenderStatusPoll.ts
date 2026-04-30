import {useCallback, useEffect, useRef} from 'react';
import {getErrorMessage} from '../app/workflow';
import {fetchJson} from '../services/api/client';
import type {RenderStatus} from '../types';

type UseRenderStatusPollOptions = {
  setRender: React.Dispatch<React.SetStateAction<RenderStatus | null>>;
  pushLog: (line: string) => void;
};

export function useRenderStatusPoll({setRender, pushLog}: UseRenderStatusPollOptions) {
  const renderPollErrorRef = useRef<string | null>(null);

  const noteRenderStatusError = useCallback((error: unknown) => {
    const message = getErrorMessage(error);
    const isNew = renderPollErrorRef.current !== message;
    if (isNew) {
      pushLog(`渲染状态刷新失败：${message}`);
      renderPollErrorRef.current = message;
    }
    setRender((current) => {
      const logLine = `[${new Date().toLocaleTimeString()}] 渲染状态刷新失败：${message}`;
      return {
        running: false,
        exitCode: current?.exitCode ?? null,
        startTime: current?.startTime ?? null,
        endTime: current?.endTime ?? Date.now(),
        outputFile: current?.outputFile ?? 'output/video.mp4',
        mode: current?.mode ?? 'full',
        sceneId: current?.sceneId ?? null,
        progress: current?.progress
          ? {...current.progress, phase: 'failed'}
          : {rendered: 0, total: null, encoded: 0, percent: 0, phase: 'failed'},
        logs: isNew ? [...(current?.logs ?? []), logLine].slice(-200) : (current?.logs ?? []),
        error: message,
        videoUrl: current?.videoUrl ?? null,
        videoExists: current?.videoExists ?? false,
      };
    });
  }, [pushLog, setRender]);

  const fetchRenderStatus = useCallback(async () => {
    try {
      const status = await fetchJson<RenderStatus>('/api/render/status');
      setRender(status);
      if (renderPollErrorRef.current) {
        pushLog('渲染状态刷新已恢复');
        renderPollErrorRef.current = null;
      }
      return status;
    } catch (error) {
      noteRenderStatusError(error);
      return null;
    }
  }, [noteRenderStatusError, pushLog, setRender]);

  useEffect(() => {
    const timer = setInterval(fetchRenderStatus, 1000);
    return () => clearInterval(timer);
  }, [fetchRenderStatus]);

  return {fetchRenderStatus, noteRenderStatusError};
}
