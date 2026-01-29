/**
 * NapCat (OneBot 11) API Types
 */

// OneBot 11 Event Common Fields
export interface OB11BaseEvent {
  time: number;
  self_id: number;
  post_type: 'message' | 'request' | 'notice' | 'meta_event';
}

// Sender Info
export interface OB11Sender {
  user_id: number;
  nickname: string;
  card?: string;
  sex?: 'male' | 'female' | 'unknown';
  age?: number;
  role?: 'owner' | 'admin' | 'member';
}

// Message Event
export interface OB11MessageEvent extends OB11BaseEvent {
  post_type: 'message';
  message_type: 'private' | 'group';
  sub_type: 'friend' | 'group' | 'normal' | 'anonymous' | 'notice';
  message_id: number;
  user_id: number;
  message: OB11MessageSegment[] | string;
  raw_message: string;
  font: number;
  sender: OB11Sender;
  group_id?: number;
  anonymous?: any;
}

// Message Segment
export interface OB11MessageSegment {
  type: string;
  data: Record<string, any>;
}

// Meta Event (Heartbeat/Lifecycle)
export interface OB11MetaEvent extends OB11BaseEvent {
  post_type: 'meta_event';
  meta_event_type: 'lifecycle' | 'heartbeat';
  sub_type?: 'connect' | 'enable' | 'disable';
  status?: any;
  interval?: number;
}

// Action Response
export interface OB11Response<T = any> {
  status: 'ok' | 'failed';
  retcode: number;
  data: T;
  message: string;
  wording?: string;
  echo?: string;
}

// Send Message Params
export interface OB11SendMessageParams {
  detail_type?: 'private' | 'group'; // extended
  message_type?: 'private' | 'group';
  user_id?: number;
  group_id?: number;
  message: OB11MessageSegment[] | string;
  auto_escape?: boolean;
}

// Get User Info Params
export interface OB11GetUserInfoParams {
  user_id: number;
  no_cache?: boolean;
}

// Get Group Info Params
export interface OB11GetGroupInfoParams {
  group_id: number;
  no_cache?: boolean;
}

// Account Configuration
export interface NapCatAccount {
  wsUrl?: string;
  httpUrl?: string;
  token?: string;
  adminUins?: number[];
  debug?: boolean;
}

// Helper for mapping NapCat event to internal type
export interface NapCatEvent extends OB11MessageEvent {}
