import { useEffect, useState } from 'react';
import type { ConnectionState, RealtimeEvent } from '../types';
import { realtime } from '../services/realtime';

export function useRealtime(onEvent?: (event: RealtimeEvent) => void) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    realtime.connect(sessionStorage.getItem('lanvault-session-token') ?? '');
    const unsubscribeState = realtime.subscribeState(setState);
    const unsubscribeEvent = onEvent ? realtime.subscribe(onEvent) : undefined;
    return () => {
      unsubscribeState();
      unsubscribeEvent?.();
    };
  }, [onEvent]);
  return state;
}
