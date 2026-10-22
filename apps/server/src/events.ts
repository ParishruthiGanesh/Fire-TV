import type { Response } from 'express';
import type { WebSocket } from 'ws';
import type { ServerEvent } from '@alongside/shared';

interface Subscriber {
  id: number;
  householdId: string;
  /** Browsers get Server-Sent Events; React Native gets a WebSocket. */
  kind: 'sse' | 'ws';
  res?: Response;
  socket?: WebSocket;
}

/**
 * Server-Sent Events hub.
 *
 * Every state change is broadcast to all clients in the household, so the TV,
 * the voice client and the dashboard converge without polling. SSE (rather
 * than WebSocket) because browsers and React Native reconnect it for us and
 * because every message in this product flows server -> client; client -> server
 * goes through ordinary validated POSTs.
 */
export class EventHub {
  private subscribers: Subscriber[] = [];
  private nextId = 1;

  subscribe(householdId: string, res: Response): () => void {
    const sub: Subscriber = { id: this.nextId++, householdId, kind: 'sse', res };
    this.subscribers.push(sub);
    res.write(`retry: 2000\n\n`);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s.id !== sub.id);
    };
  }

  /**
   * WebSocket subscription, for clients without EventSource.
   *
   * React Native has no EventSource and no streaming fetch, so the Fire TV app
   * connects here instead. Same events, same household scoping, same ordering.
   */
  subscribeSocket(householdId: string, socket: WebSocket): () => void {
    const sub: Subscriber = { id: this.nextId++, householdId, kind: 'ws', socket };
    this.subscribers.push(sub);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s.id !== sub.id);
    };
  }

  publish(householdId: string, event: ServerEvent): void {
    const json = JSON.stringify(event);
    const sse = `data: ${json}\n\n`;
    for (const sub of this.subscribers) {
      if (sub.householdId !== householdId) continue;
      try {
        if (sub.kind === 'sse') sub.res?.write(sse);
        else if (sub.socket?.readyState === 1) sub.socket.send(json);
      } catch {
        // Dropped connection; the close handler removes the subscriber.
      }
    }
  }

  count(householdId?: string): number {
    return householdId
      ? this.subscribers.filter((s) => s.householdId === householdId).length
      : this.subscribers.length;
  }

  closeAll(): void {
    for (const sub of this.subscribers) {
      try {
        if (sub.kind === 'sse') sub.res?.end();
        else sub.socket?.close();
      } catch {
        /* ignore */
      }
    }
    this.subscribers = [];
  }
}
