import {useCallback, useEffect, useRef} from 'react';
import {getErrorMessage} from '../app/workflow';
import {fetchJson} from '../services/api/client';
import type {CodegenStatus} from '../types';

type UseCodegenStatusPollOptions = {
  setCodegen: React.Dispatch<React.SetStateAction<CodegenStatus | null>>;
  refresh: () => Promise<void>;
  setCacheKey: React.Dispatch<React.SetStateAction<number>>;
  pushLog: (line: string) => void;
};

export function useCodegenStatusPoll({setCodegen, refresh, setCacheKey, pushLog}: UseCodegenStatusPollOptions) {
  const codegenPollErrorRef = useRef<string | null>(null);

  const noteCodegenStatusError = useCallback((error: unknown) => {
    const message = getErrorMessage(error);
    const isNew = codegenPollErrorRef.current !== message;
    if (isNew) {
      pushLog(`Remotion 代码生成状态刷新失败：${message}`);
      codegenPollErrorRef.current = message;
    }
    setCodegen((current) => ({
      running: false,
      sceneId: current?.sceneId ?? null,
      provider: current?.provider ?? null,
      step: 'failed',
      message: 'Remotion 代码生成状态刷新失败',
      startTime: current?.startTime ?? null,
      endTime: Date.now(),
      targetFile: current?.targetFile ?? null,
      error: message,
      result: current?.result ?? null,
      logs: isNew ? [...(current?.logs ?? []), `[${new Date().toLocaleTimeString()}] Remotion 代码生成状态刷新失败：${message}`].slice(-160) : (current?.logs ?? []),
    }));
  }, [pushLog, setCodegen]);

  useEffect(() => {
    let wasRunning = false;
    const poll = async () => {
      try {
        const status = await fetchJson<CodegenStatus>('/api/scene/codegen/status');
        setCodegen(status);
        if (codegenPollErrorRef.current) {
          pushLog('Remotion 代码生成状态刷新已恢复');
          codegenPollErrorRef.current = null;
        }
        if (status.running || wasRunning) {
          await refresh();
          if (!status.running && wasRunning && !status.error) {
            setCacheKey(Date.now());
            pushLog(`${status.sceneId ?? '当前场景'} Remotion 代码生成完成`);
          }
        }
        wasRunning = status.running;
      } catch (error) {
        wasRunning = false;
        noteCodegenStatusError(error);
      }
    };
    poll();
    const timer = setInterval(poll, 1000);
    return () => clearInterval(timer);
  }, [noteCodegenStatusError, pushLog, refresh, setCacheKey, setCodegen]);
}
