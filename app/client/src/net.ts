import type { ClientMsg, ServerMsg } from '../../shared/protocol';

// Conexão em tempo real com o servidor, com reconexão automática e indicação de estado.

export type NetState = 'connecting' | 'online' | 'reconnecting' | 'replaced' | 'closed' | 'forbidden';

export class Net {
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private pingTimer = 0;
  onMessage: (m: ServerMsg) => void = () => {};
  onState: (s: NetState) => void = () => {};

  connect() {
    this.stopped = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.onState(this.retry ? 'reconnecting' : 'connecting');
    ws.onopen = () => {
      this.retry = 0;
      this.onState('online');
      clearInterval(this.pingTimer);
      // mantém a conexão viva mesmo com a aba em segundo plano
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 20_000);
    };
    ws.onmessage = (e) => {
      try { this.onMessage(JSON.parse(e.data) as ServerMsg); } catch (err) { console.error(err); }
    };
    ws.onclose = (e) => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (e.code === 4001) { this.stopped = true; return this.onState('replaced'); }
      if (e.code === 4003) { this.stopped = true; return this.onState('forbidden'); }
      if (this.stopped) return this.onState('closed');
      // tenta de novo com espera crescente, até 10 s
      this.onState('reconnecting');
      const wait = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => !this.stopped && this.connect(), wait);
    };
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Sair do escritório: o servidor remove o avatar na hora. */
  leave() {
    this.stopped = true;
    this.ws?.close(4000, 'leave');
  }
}
