/**
 * NapCat Channel Plugin for Clawdbot
 * Implements the ChannelPlugin interface
 */

import type { ChannelPlugin } from './sdk-types.js';
import { NapCatApiClient } from './api/client.js';
import { NapCatRuntime, getNapCatRuntime } from './runtime.js';
import type { NapCatAccount, OB11MessageEvent } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

// Store for active runtimes and API clients
const activeRuntimes: Map<string, NapCatRuntime> = new Map();
const apiClients: Map<string, NapCatApiClient> = new Map();

// Store for preventing duplicate replies
const recentReplies: Map<string, { text: string; timestamp: number }> = new Map();
const REPLY_DEDUP_WINDOW_MS = 5000;

const DEFAULT_ACCOUNT_ID = 'default';

function resolveNapCatAccount(cfg: any, accountId: string): NapCatAccount | null {
  const napConfig = cfg?.channels?.['napcat-channel'];
  if (!napConfig) return null;

  if (napConfig.accounts && napConfig.accounts[accountId]) {
    return napConfig.accounts[accountId];
  }

  if (accountId === DEFAULT_ACCOUNT_ID && (napConfig.wsUrl || napConfig.httpUrl)) {
    return {
      wsUrl: napConfig.wsUrl ? String(napConfig.wsUrl) : undefined,
      httpUrl: napConfig.httpUrl ? String(napConfig.httpUrl) : undefined,
      token: napConfig.token ? String(napConfig.token) : undefined,
      adminUins: napConfig.adminUins ? (Array.isArray(napConfig.adminUins) ? napConfig.adminUins : [napConfig.adminUins]) : undefined,
    };
  }

  return null;
}

function listNapCatAccountIds(cfg: any): string[] {
  const napConfig = cfg?.channels?.['napcat-channel'];
  if (!napConfig) return [];
  if (napConfig.accounts) return Object.keys(napConfig.accounts);
  if (napConfig.wsUrl || napConfig.httpUrl) return [DEFAULT_ACCOUNT_ID];
  return [];
}

function getOrCreateApiClient(accountId: string, config: NapCatAccount): NapCatApiClient {
  let client = apiClients.get(accountId);
  if (!client) {
    client = new NapCatApiClient(config);
    apiClients.set(accountId, client);
  }
  return client;
}

// Helper to parse target ID (e.g., "group:123" -> { type: 'group', id: 123 })
function parseTarget(target: string): { type: 'group' | 'private'; id: number } {
  // Strip plugin prefix if present
  if (target.startsWith('napcat-channel:')) {
    target = target.replace(/^napcat-channel:/, '');
  }

  if (target.startsWith('group:')) {
    return { type: 'group', id: parseInt(target.replace('group:', ''), 10) };
  }
  if (target.startsWith('private:')) {
    return { type: 'private', id: parseInt(target.replace('private:', ''), 10) };
  }
  throw new Error(`Invalid target format: ${target} (expected group:ID or private:ID)`);
}

export const napcatChannelPlugin: ChannelPlugin<NapCatAccount> = {
  id: 'napcat-channel',

  meta: {
    label: 'NapCat Channel',
    docsPath: 'channels/napcat-channel',
    blurb: 'Connect to QQ via NapCat (OneBot 11)',
  },

  capabilities: {
    chatTypes: ['channel', 'direct'],
    reactions: false, 
    threads: false,
    media: true,
    nativeCommands: true,
    blockStreaming: false,
  },

  reload: {
    configPrefixes: ['channels.napcat-channel'],
  },

  configSchema: {
    type: 'object',
    properties: {
      wsUrl: { type: 'string', description: 'WebSocket URL' },
      httpUrl: { type: 'string', description: 'HTTP API URL' },
      token: { type: 'string', description: 'Access Token (optional)' },
      adminUins: { 
        type: 'array', 
        items: { type: 'number' },
        description: 'List of admin QQ numbers (only these users can trigger the bot)'
      },
      accounts: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            wsUrl: { type: 'string' },
            httpUrl: { type: 'string' },
            token: { type: 'string' },
            adminUins: { type: 'array', items: { type: 'number' } },
          },
        },
      },
    },
  },

  config: {
    listAccountIds: (cfg) => listNapCatAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveNapCatAccount(cfg, accountId),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (account) => !!(account && (account.wsUrl || account.httpUrl)),
    describeAccount: (account) => ({
      name: `NapCat ${account.httpUrl || account.wsUrl}`,
      fields: {
        wsUrl: account.wsUrl || 'N/A',
        httpUrl: account.httpUrl || 'N/A',
      },
    }),
  },

  outbound: {
    deliveryMode: 'direct',
    textChunkLimit: 4000,

    sendText: async ({ to, text, accountId, replyToId }) => {
      console.log(`[NapCat] outbound.sendText called to=${to} text=${text.slice(0, 20)}...`);
      const runtime = getNapCatRuntime();
      const cfg = runtime.config.loadConfig();
      const account = resolveNapCatAccount(cfg, accountId);
      if (!account) throw new Error(`Account ${accountId} not configured`);

      const client = getOrCreateApiClient(accountId, account);
      const { type, id } = parseTarget(to);

      const response = await client.sendMessage({
        message_type: type,
        [type === 'group' ? 'group_id' : 'user_id']: id,
        message: text,
      });

      return {
        messageId: String(response.message_id),
        timestamp: new Date(),
      };
    },

    sendMedia: async ({ to, text, mediaUrl, accountId, replyToId }) => {
      console.log(`[NapCat] outbound.sendMedia called to=${to} mediaUrl=${mediaUrl}`);
      const runtime = getNapCatRuntime();
      const cfg = runtime.config.loadConfig();
      const account = resolveNapCatAccount(cfg, accountId);
      if (!account) throw new Error(`Account ${accountId} not configured`);

      const client = getOrCreateApiClient(accountId, account);
      const { type, id } = parseTarget(to);

      let fileData = mediaUrl;
      
      // If it looks like a local absolute path, check if we need to base64 encode it
      // This is necessary if NapCat is running on a different machine/container
      if (fileData.startsWith('/') && fs.existsSync(fileData)) {
          try {
              const fileBuffer = fs.readFileSync(fileData);
              const base64 = fileBuffer.toString('base64');
              fileData = `base64://${base64}`;
              console.log(`[NapCat] Converted local file ${mediaUrl} to base64 (${base64.length} chars)`);
          } catch (err) {
              console.error(`[NapCat] Failed to read local file ${mediaUrl}:`, err);
              // Fallback to file:// protocol if read fails, though it likely won't work remotely
              if (!fileData.startsWith('file://')) {
                  fileData = `file://${fileData}`;
              }
          }
      } else if (fileData.startsWith('/') && !fileData.startsWith('file://')) {
          fileData = `file://${fileData}`;
      }

      const message = [
        { type: 'image', data: { file: fileData } }
      ];
      if (text) {
        message.unshift({ type: 'text', data: { text: text + ' ' } } as any);
      }

      const response = await client.sendMessage({
        message_type: type,
        [type === 'group' ? 'group_id' : 'user_id']: id,
        message: message as any,
      });

      return {
        messageId: String(response.message_id),
        timestamp: new Date(),
      };
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: () => ({ health: 'ok' }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      account: {
        id: runtime?.accountId || DEFAULT_ACCOUNT_ID,
        name: `NapCat ${account.httpUrl || account.wsUrl}`,
        configured: !!(account.wsUrl || account.httpUrl),
      },
      runtime: runtime || {
        accountId: DEFAULT_ACCOUNT_ID,
        running: false,
      },
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      const { accountId, cfg } = ctx;
      if (activeRuntimes.has(accountId)) {
        console.log(`[NapCat] Account ${accountId} already running`);
        return null;
      }

      const account = resolveNapCatAccount(cfg, accountId);
      if (!account) throw new Error(`Account ${accountId} not configured`);

      const client = getOrCreateApiClient(accountId, account);

      const runtime = new NapCatRuntime({
        account,
        accountId,
        apiClient: client,

        onMessage: async (message: OB11MessageEvent) => {
          // Check Admin Permission
          if (account.adminUins && account.adminUins.length > 0) {
            if (!account.adminUins.includes(message.user_id)) {
               console.log(`[NapCat] Ignored message from non-admin user: ${message.user_id}`);
               return;
            }
          }

          // Check Mention in Group
          if (message.message_type === 'group') {
            let isMentioned = false;
            if (Array.isArray(message.message)) {
              isMentioned = message.message.some(seg => seg.type === 'at' && String(seg.data.qq) === String(message.self_id));
            } else if (typeof message.message === 'string') {
              isMentioned = message.message.includes(`[CQ:at,qq=${message.self_id}]`);
            }
            if (!isMentioned) return;
          }

          const core = getNapCatRuntime();
          const cfg = core.config.loadConfig();

          // Extract text
          let messageText = '';
          let mediaUrl: string | undefined;

          if (typeof message.message === 'string') {
            messageText = message.message;
          } else if (Array.isArray(message.message)) {
             messageText = message.message
                .filter(seg => seg.type === 'text')
                .map(seg => seg.data.text)
                .join('');
                
             // Extract first image URL if available
             const imageSeg = message.message.find(seg => seg.type === 'image');
             if (imageSeg && imageSeg.data) {
                 mediaUrl = imageSeg.data.url || imageSeg.data.file;
             }
          }
          messageText = messageText.trim();

          // If no text but we have media, create a placeholder text to ensure processing
          if (!messageText && mediaUrl) {
              messageText = '[Image]';
          }
          
          // Append Media URL to text so the agent can see it
          if (mediaUrl) {
              messageText += `\n[MediaUrl: ${mediaUrl}]`;
          }

          if (!messageText) return;

          // Determine peer and IDs
          const isDirect = message.message_type === 'private';
          const peerId = isDirect ? String(message.user_id) : String(message.group_id);
          const channelId = isDirect ? `private:${message.user_id}` : `group:${message.group_id}`;

          // Log
          console.log(`[NapCat] Received ${message.message_type} from ${message.sender.nickname} (${message.user_id}): ${messageText.slice(0, 50)}`);

          const route = core.channel.routing.resolveAgentRoute({
            cfg,
            channel: 'napcat-channel',
            accountId,
            peer: {
              kind: isDirect ? 'dm' : 'channel',
              id: peerId,
            },
          });

          const senderName = message.sender.nickname || String(message.user_id);
          const fromLabel = isDirect ? senderName : `${senderName} in group ${message.group_id}`;
          const timestamp = message.time * 1000;

          const isCommand = core.channel.text.hasControlCommand(messageText, cfg);

          const body = core.channel.reply.formatAgentEnvelope({
            channel: 'NapCat',
            from: fromLabel,
            timestamp,
            body: messageText,
          });

          const ctxPayload = core.channel.reply.finalizeInboundContext({
            Body: body,
            RawBody: messageText,
            CommandBody: messageText,
            MediaUrl: mediaUrl,
            From: `napcat-channel:${isDirect ? 'dm' : 'channel'}:${peerId}`, 
            To: `napcat-channel:${channelId}`, 
            SessionKey: route.sessionKey,
            AccountId: route.accountId,
            ChatType: isDirect ? 'direct' : 'channel',
            ConversationLabel: fromLabel,
            SenderName: senderName,
            SenderId: String(message.user_id),
            SenderUsername: message.sender.nickname,
            GroupSubject: isDirect ? undefined : String(message.group_id),
            GroupChannel: isDirect ? undefined : String(message.group_id),
            Provider: 'napcat-channel',
            Surface: 'napcat-channel',
            MessageSid: String(message.message_id),
            CommandAuthorized: isCommand ? true : undefined,
            OriginatingChannel: 'napcat-channel',
            OriginatingTo: `napcat-channel:${channelId}`,
          });

          const responsePrefix = core.channel.reply.resolveEffectiveMessagesConfig(cfg, route.agentId).responsePrefix;
          const humanDelay = core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId);

          try {
            await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
              ctx: ctxPayload,
              cfg,
              dispatcherOptions: {
                responsePrefix,
                humanDelay,
                deliver: async (payload) => {
                  // Inspect payload to find media
                  const replyText = payload.text;
                  
                  // Clawdbot might pass media in 'media', 'files', 'mediaUrls' (array), or 'mediaUrl' (string)
                  let replyMedia: string[] = [];
                  
                  if (Array.isArray(payload.media)) {
                    replyMedia = payload.media;
                  } else if (Array.isArray(payload.files)) {
                    replyMedia = payload.files;
                  } else if (Array.isArray(payload.mediaUrls)) {
                    replyMedia = payload.mediaUrls;
                  } else if (typeof payload.mediaUrl === 'string' && payload.mediaUrl) {
                    replyMedia = [payload.mediaUrl];
                  }

                  console.log(`[NapCat] Deliver payload keys: ${Object.keys(payload).join(', ')}`);

                  if (!replyText && replyMedia.length === 0) return;

                  // Simple dedup
                  const messageKey = `${channelId}:${message.message_id}`;
                  const lastReply = recentReplies.get(messageKey);
                  const now = Date.now();
                  
                  // Only dedup if it's text-only and matches exactly
                  if (replyMedia.length === 0 && lastReply && lastReply.text === replyText && (now - lastReply.timestamp) < REPLY_DEDUP_WINDOW_MS) {
                    return;
                  }

                  console.log(`[NapCat] Sending reply to ${channelId}: ${replyText ? replyText.slice(0, 50) : ''} [Media: ${replyMedia.length}]`);

                  let messageBody: any = replyText;

                  // If we have media, we must use the segment array format
                  if (replyMedia.length > 0) {
                    messageBody = [];
                    
                    // Add text segment if exists
                    if (replyText) {
                      messageBody.push({ type: 'text', data: { text: replyText } });
                    }

                    // Add image segments
                    for (const mediaItem of replyMedia) {
                      let fileData = mediaItem;
                      
                      // Handle local files for remote NapCat
                      if (fileData.startsWith('/') && fs.existsSync(fileData)) {
                          try {
                              const fileBuffer = fs.readFileSync(fileData);
                              const base64 = fileBuffer.toString('base64');
                              fileData = `base64://${base64}`;
                              console.log(`[NapCat] Converted local file ${mediaItem} to base64 (${base64.length} chars)`);
                          } catch (err) {
                              console.error(`[NapCat] Failed to read local file ${mediaItem}:`, err);
                              if (!fileData.startsWith('file://')) {
                                  fileData = `file://${fileData}`;
                              }
                          }
                      } else if (fileData.startsWith('/') && !fileData.startsWith('file://')) {
                          fileData = `file://${fileData}`;
                      }
                      
                      messageBody.push({ type: 'image', data: { file: fileData } });
                    }
                  }

                  await client.sendMessage({
                    message_type: isDirect ? 'private' : 'group',
                    [isDirect ? 'user_id' : 'group_id']: isDirect ? message.user_id : message.group_id,
                    message: messageBody
                  });

                  recentReplies.set(messageKey, { text: replyText || '', timestamp: now });
                },
                onError: (err, info) => {
                  console.error(`[NapCat] ${info.kind} reply failed:`, err);
                }
              }
            });
          } catch (err) {
            console.error('[NapCat] Failed to dispatch reply:', err);
          }
        },

        onReady: (userId, nickname) => {
            console.log(`[NapCat] Account ${accountId} ready: ${nickname} (${userId})`);
        },
        onError: (err) => {
            console.error(`[NapCat] Account ${accountId} error:`, err);
        }
      });

      activeRuntimes.set(accountId, runtime);
      await runtime.start();

      return async () => {
        const rt = activeRuntimes.get(accountId);
        if (rt) {
          await rt.stop();
          activeRuntimes.delete(accountId);
          apiClients.delete(accountId);
        }
      };
    }
  }
};
