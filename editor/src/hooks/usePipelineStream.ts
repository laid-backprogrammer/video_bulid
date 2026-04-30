import {useEffect, useRef} from 'react';
import {getErrorMessage} from '../app/workflow';
import type {PipelineStatus} from '../types';

type UsePipelineStreamOptions = {
  setPipeline: React.Dispatch<React.SetStateAction<PipelineStatus | null>>;
  pushLog: (line: string) => void;
};

export function usePipelineStream({setPipeline, pushLog}: UsePipelineStreamOptions) {
  const pipelineStreamErrorRef = useRef<string | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/pipeline/stream');
    es.addEventListener('status', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        setPipeline(data.payload);
        pipelineStreamErrorRef.current = null;
      } catch (error) {
        pushLog(`流水线状态解析失败：${getErrorMessage(error)}`);
      }
    });
    es.addEventListener('log', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        pushLog(data.payload.text);
      } catch (error) {
        pushLog(`流水线日志解析失败：${getErrorMessage(error)}`);
      }
    });
    es.addEventListener('error', () => {
      if (!pipelineStreamErrorRef.current) {
        pipelineStreamErrorRef.current = 'disconnected';
        pushLog('流水线状态连接中断，正在等待浏览器自动重连');
      }
      setPipeline((current) => (current?.running ? {...current, running: false} : current));
    });
    return () => es.close();
  }, [pushLog, setPipeline]);
}
