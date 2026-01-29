/**
 * NapCat Channel Plugin for Clawdbot
 * Implements the ChannelPlugin interface
 */

import type { ChannelPlugin } from './sdk-types.js';
import { NapCatApiClient } from './api/client.js';
import { NapCatRuntime, getNapCatRuntime } from './runtime.js';
import type { NapCatAccount, OB11MessageEvent } from './types.js';

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
      const runtime = getNapCatRuntime();
      const cfg = runtime.config.loadConfig();
      const account = resolveNapCatAccount(cfg, accountId);
      if (!account) throw new Error(`Account ${accountId} not configured`);

      const client = getOrCreateApiClient(accountId, account);
      const { type, id } = parseTarget(to);

      const message = [
        { type: 'image', data: { file: mediaUrl } }
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

          const core = getNapCatRuntime();
          const cfg = core.config.loadConfig();

          // Extract text
          let messageText = '';
          if (typeof message.message === 'string') {
            messageText = message.message;
          } else if (Array.isArray(message.message)) {
             messageText = message.message
                .filter(seg => seg.type === 'text')
                .map(seg => seg.data.text)
                .join('');
          }
          messageText = messageText.trim();

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
                  const replyText = payload.text;
                  const replyMedia = payload.media || [];

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
                      messageBody.push({ type: 'image', data: { file: mediaItem } });
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
