/**
 * NapCat (OneBot 11) Runtime
 */

import type { PluginRuntime } from './sdk-types.js';
import WebSocket from 'ws';
import {
  NapCatAccount,
  OB11MessageEvent,
  NapCatEvent
} from './types.js';
import { NapCatApiClient } from './api/client.js';

// Plugin runtime storage
let pluginRuntime: PluginRuntime | null = null;

export function setNapCatRuntime(runtime: PluginRuntime): void {
  pluginRuntime = runtime;
}

export function getNapCatRuntime(): PluginRuntime {
  if (!pluginRuntime) {
    throw new Error('NapCat runtime not initialized');
  }
  return pluginRuntime;
}

export interface RuntimeConfig {
  account: NapCatAccount;
  accountId: string;
  apiClient: NapCatApiClient;
  onMessage: (message: OB11MessageEvent) => void;
  onReady: (userId: number, nickname: string) => void;
  onError: (error: Error) => void;
}

export class NapCatRuntime {
  private config: RuntimeConfig;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 3000;
  private isClosing = false;
  
  constructor(config: RuntimeConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    try {
      // Allow starting without WS if HTTP is configured (but usually we need WS for events)
      // Actually, if we only have HTTP, we can't receive messages, but maybe that's what the user wants?
      // But NapCat usually needs WS for events.
      // Let's assume if wsUrl is missing, we just don't connect WS.
      
      // Try to get login info first to verify connection (HTTP or WS later)
      if (this.config.account.httpUrl) {
        try {
          const loginInfo = await this.config.apiClient.getLoginInfo();
          console.log(`[NapCat] HTTP connection verified. Logged in as: ${loginInfo.nickname} (${loginInfo.user_id})`);
          this.config.onReady(loginInfo.user_id, loginInfo.nickname);
        } catch (err) {
          console.warn(`[NapCat] Failed to get login info via HTTP:`, err);
        }
      }

      if (this.config.account.wsUrl) {
        console.log(`[NapCat] Connecting to WebSocket: ${this.config.account.wsUrl}`);
        
        const options: WebSocket.ClientOptions = {};
        if (this.config.account.token) {
          options.headers = {
            Authorization: `Bearer ${this.config.account.token}`
          };
        }

        this.ws = new WebSocket(this.config.account.wsUrl, options);
        this.setupWebSocketHandlers();
      } else {
        if (!this.config.account.httpUrl) {
           throw new Error('Neither wsUrl nor httpUrl is configured');
        }
        console.warn('[NapCat] No wsUrl configured, running in HTTP-only mode (cannot receive messages)');
      }
    } catch (error) {
      console.error('[NapCat] Failed to start runtime:', error);
      this.config.onError(error as Error);
      this.scheduleReconnect();
    }
  }

  async stop(): Promise<void> {
    this.isClosing = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.reconnectAttempts = 0;
  }

  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      console.log('[NapCat] WebSocket connected');
      this.reconnectAttempts = 0;
      
      // Inject WS into Client for fallback
      this.config.apiClient.setWs(this.ws!);
      
      // If we haven't identified via HTTP, try via WS
      if (!this.config.account.httpUrl) {
         this.config.apiClient.getLoginInfo()
           .then(info => {
              console.log(`[NapCat] WS connection verified. Logged in as: ${info.nickname} (${info.user_id})`);
              this.config.onReady(info.user_id, info.nickname);
           })
           .catch(err => console.warn('[NapCat] Failed to get login info via WS:', err));
      }
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const raw = data.toString();
        const payload = JSON.parse(raw);
        this.handlePayload(payload);
      } catch (error) {
        console.error('[NapCat] Failed to parse message:', error);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[NapCat] WebSocket closed: ${code} ${reason}`);
      this.config.apiClient.setWs(null as any); // Clear WS from client
      if (!this.isClosing) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (error) => {
      console.error('[NapCat] WebSocket error:', error);
      this.config.onError(error);
    });
  }

  private handlePayload(payload: any): void {
    // Check for API Response (has echo)
    if (payload.echo) {
      this.config.apiClient.handleWsResponse(payload);
      return;
    }

    // Check event type
    if (payload.post_type === 'message') {
      this.config.onMessage(payload as OB11MessageEvent);
    } else if (payload.post_type === 'meta_event') {
       if (payload.meta_event_type === 'lifecycle' && payload.sub_type === 'connect') {
           console.log('[NapCat] Lifecycle: Connected');
       }
    }
  }

  private scheduleReconnect(): void {
    if (this.isClosing) return;
    if (!this.config.account.wsUrl) return; // Don't reconnect if no WS

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[NapCat] Max reconnect attempts reached');
      this.config.onError(new Error('Max reconnect attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.baseReconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 60000);

    console.log(`[NapCat] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      if (!this.isClosing) {
        this.reconnect();
      }
    }, delay);
  }

  private async reconnect(): Promise<void> {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate(); 
      this.ws = null;
    }
    this.start();
  }
}
