/**
 * NapCat (OneBot 11) API Client
 * Supports both HTTP and WebSocket transport
 */

import {
  OB11Response,
  OB11SendMessageParams,
  NapCatAccount
} from '../types.js';
import WebSocket from 'ws';
import { EventEmitter } from 'events';

export class NapCatApiClient {
  private httpUrl?: string;
  private token?: string;
  private ws: WebSocket | null = null;
  private responseEmitter = new EventEmitter();
  private wsSequence = 0;

  constructor(config: NapCatAccount) {
    if (config.httpUrl) {
      this.httpUrl = config.httpUrl.replace(/\/$/, '');
    }
    this.token = config.token;
  }

  /**
   * Set WebSocket connection for API calls
   */
  setWs(ws: WebSocket) {
    this.ws = ws;
  }

  /**
   * Handle incoming WebSocket response
   */
  handleWsResponse(payload: any) {
    if (payload.echo) {
      this.responseEmitter.emit(payload.echo, payload);
    }
  }

  /**
   * Make an authenticated API request (HTTP preferred, WS fallback)
   */
  private async request<T>(endpoint: string, body: any): Promise<T> {
    // 1. Try HTTP if configured
    if (this.httpUrl) {
      return this.requestHttp<T>(endpoint, body);
    }

    // 2. Try WebSocket if available
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return this.requestWs<T>(endpoint, body);
    }

    throw new Error('No available transport for API request (HTTP not configured, WS not connected)');
  }

  private async requestHttp<T>(endpoint: string, body: any): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const url = `${this.httpUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`API request failed: ${response.status} ${text}`);
      }

      const result = await response.json() as OB11Response<T>;
      
      if (result.status === 'failed' && result.retcode !== 0) {
         throw new Error(`NapCat API error: [${result.retcode}] ${result.message || result.wording}`);
      }

      return result.data;
    } catch (error) {
      console.error(`[NapCat] HTTP Request to ${endpoint} failed:`, error);
      throw error;
    }
  }

  private async requestWs<T>(endpoint: string, params: any): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('WebSocket not initialized'));

      const echo = `api_${Date.now()}_${this.wsSequence++}`;
      const action = endpoint.replace(/^\//, ''); // /send_msg -> send_msg

      const payload = {
        action,
        params,
        echo
      };

      // Set timeout
      const timeout = setTimeout(() => {
        this.responseEmitter.removeAllListeners(echo);
        reject(new Error(`WebSocket API request timed out: ${action}`));
      }, 10000);

      // Listen for response
      this.responseEmitter.once(echo, (response: OB11Response<T>) => {
        clearTimeout(timeout);
        if (response.status === 'failed' && response.retcode !== 0) {
          reject(new Error(`NapCat API error: [${response.retcode}] ${response.message || response.wording}`));
        } else {
          resolve(response.data);
        }
      });

      // Send
      this.ws.send(JSON.stringify(payload));
    });
  }

  /**
   * Send a message (auto-detects private/group based on params)
   */
  async sendMessage(params: OB11SendMessageParams): Promise<{ message_id: number }> {
     let endpoint = '/send_msg';
     if (params.message_type === 'private') endpoint = '/send_private_msg';
     if (params.message_type === 'group') endpoint = '/send_group_msg';

     return this.request<{ message_id: number }>(endpoint, params);
  }
  
  /**
   * Delete a message
   */
  async deleteMessage(messageId: number): Promise<void> {
      await this.request('/delete_msg', { message_id: messageId });
  }

  /**
   * Get user info
   */
  async getUserInfo(userId: number): Promise<{ user_id: number; nickname: string; sex: string; age: number }> {
      return this.request('/get_stranger_info', { user_id: userId });
  }

  /**
   * Get group info
   */
  async getGroupInfo(groupId: number): Promise<{ group_id: number; group_name: string; member_count: number; max_member_count: number }> {
      return this.request('/get_group_info', { group_id: groupId });
  }

  /**
   * Get login info
   */
  async getLoginInfo(): Promise<{ user_id: number; nickname: string }> {
      return this.request('/get_login_info', {});
  }

  /**
   * Get group file URL (NapCat extension)
   */
  async getGroupFileUrl(groupId: number, fileId: string): Promise<{ url: string }> {
      return this.request('/get_group_file_url', { group_id: groupId, file_id: fileId });
  }

  /**
   * Get private file URL (NapCat extension)
   */
  async getPrivateFileUrl(fileId: string): Promise<{ url: string }> {
      return this.request('/get_private_file_url', { file_id: fileId });
  }
}
