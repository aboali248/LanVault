import type { RealtimeEvent } from '../types';

function defaultRealtimeUrl() {
  const apiUrl = new URL(import.meta.env.VITE_API_URL ?? `${window.location.protocol}//${window.location.hostname}:3031/api/v1`, window.location.href);
  apiUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  apiUrl.pathname = '/ws';
  apiUrl.search = '';
  return apiUrl.toString();
}

const realtimeUrl = import.meta.env.VITE_WS_URL ?? defaultRealtimeUrl();

export class RealtimeClient {
  private socket: WebSocket | undefined;
  private retryTimer: number | undefined;
  private attempts = 0;
  private token = '';
  private listeners = new Set<(event: RealtimeEvent) => void>();
  private stateListeners = new Set<(state: 'connecting' | 'connected' | 'disconnected') => void>();
  private closedByUser = false;

  connect(token = this.token) {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.token = token;
    this.closedByUser = false;
    this.setState('connecting');
    try {
      const socketUrl = new URL(realtimeUrl);
      socketUrl.searchParams.set('token', this.token);
      this.socket = new WebSocket(socketUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket.onopen = () => {
      this.attempts = 0;
      this.setState('connected');
    };
    this.socket.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as RealtimeEvent;
        if (event?.type) this.listeners.forEach((listener) => listener(event));
      } catch {
        // Malformed events are ignored; the HTTP API remains authoritative.
      }
    };
    this.socket.onerror = () => this.setState('disconnected');
    this.socket.onclose = () => {
      this.socket = undefined;
      this.setState('disconnected');
      if (!this.closedByUser) this.scheduleReconnect();
    };
  }

  subscribe(listener: (event: RealtimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeState(listener: (state: 'connecting' | 'connected' | 'disconnected') => void) {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  close() {
    this.closedByUser = true;
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.socket?.close();
    this.socket = undefined;
    this.setState('disconnected');
  }

  private scheduleReconnect() {
    if (this.retryTimer || this.closedByUser) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.attempts++, 5));
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }

  private setState(state: 'connecting' | 'connected' | 'disconnected') {
    this.stateListeners.forEach((listener) => listener(state));
  }
}

export const realtime = new RealtimeClient();
