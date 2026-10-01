import { z } from 'zod';

export const idSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const providerSchema = z.enum([
  'simulated',
  'openai',
  'xai',
  'gemini',
  'ollama',
  'openai-compatible',
]);
export const agentSettingsSchema = z.strictObject({
  agentId: idSchema,
  name: z.string().trim().min(1).max(60),
  role: z.string().trim().min(1).max(3000),
  provider: providerSchema,
  model: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9_.:/-]+$/),
  baseUrl: z.string().trim().max(2000).default(''),
  maxOutputTokens: z.number().int().min(128).max(16384).default(4096),
  timeoutSeconds: z.number().int().min(5).max(600).default(180),
});
export const connectionTestSchema = z.strictObject({ agentId: idSchema });
export const createRoomSchema = z.strictObject({
  title: z.string().trim().min(1).max(100),
  objective: z.string().trim().max(3000).default(''),
  maxTurns: z.number().int().min(1).max(1000).default(100),
});
export const sendSchema = z.strictObject({
  clientId: z.string().uuid(),
  body: z.string().trim().min(1).max(12000),
  type: z.enum(['question', 'update']),
  recipientIds: z.array(idSchema).max(8),
  policy: z.enum(['all', 'any', 'quorum']).default('all'),
  quorum: z.number().int().min(1).max(8).default(1),
  synthesisAgentId: idSchema.nullable().default(null),
  threadId: idSchema.nullable().default(null),
  replyTo: idSchema.nullable().default(null),
  deadlineSeconds: z.number().int().min(5).max(600).default(120),
  relayOrder: z.array(idSchema).max(12).default([]),
});
export const controlSchema = z.strictObject({ action: z.enum(['pause', 'resume', 'stop']) });
export const retrySchema = z.strictObject({ jobId: idSchema });
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type SendInput = z.input<typeof sendSchema>;
export type AgentSettingsInput = z.input<typeof agentSettingsSchema>;
export type ProviderKind = z.infer<typeof providerSchema>;
export interface ProviderStatus {
  id: ProviderKind;
  name: string;
  keyEnvironment: string | null;
  configured: boolean;
}
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}
export type RoomStatus = 'running' | 'paused' | 'stopped';
export type JobStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'refused' | 'cancelled' | 'interrupted';
export type MessageStatus =
  'complete' | 'streaming' | 'failed' | 'refused' | 'cancelled' | 'interrupted';
export type RequestStatus = 'collecting' | 'ready' | 'unresolved' | 'timed_out' | 'cancelled';

export interface Agent {
  id: string;
  name: string;
  role: string;
  provider: ProviderKind;
  model: string;
  baseUrl?: string;
  maxOutputTokens?: number;
  timeoutSeconds?: number;
  configRevision?: number;
  color: 'teal' | 'amber' | 'violet';
}
export interface Thread {
  id: string;
  title: string;
  createdAt: string;
}
export interface Message {
  id: string;
  sequence: number;
  threadId: string;
  authorId: string;
  recipientIds: string[];
  visibility: 'room';
  type: 'question' | 'update' | 'answer' | 'synthesis';
  body: string;
  status: MessageStatus;
  replyTo: string | null;
  requestId: string | null;
  snapshotId: string | null;
  createdAt: string;
  clientId?: string;
  commandHash?: string;
}
export interface ContextSnapshot {
  id: string;
  sequence: number;
  objective: string;
  agents: Agent[];
  messages: Pick<Message, 'id' | 'authorId' | 'type' | 'body'>[];
  createdAt: string;
}
export interface Request {
  id: string;
  messageId: string;
  threadId: string;
  recipientIds: string[];
  policy: 'all' | 'any' | 'quorum';
  quorum: number;
  synthesisAgentId: string | null;
  snapshotId: string;
  status: RequestStatus;
  includedMessageIds: string[];
  createdAt: string;
  deadlineAt: string;
  closedAt: string | null;
  relayId?: string;
  relayStep?: number;
}
export interface Job {
  id: string;
  requestId: string;
  agentId: string;
  kind: 'answer' | 'synthesis';
  status: JobStatus;
  snapshotId: string;
  attemptId: string | null;
  messageId: string | null;
  error: string | null;
  previousJobId: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  providerRequestId?: string;
  usage?: TokenUsage;
}
export interface Relay {
  id: string;
  messageId: string;
  threadId: string;
  order: string[];
  requestIds: string[];
  completedSteps: number;
  status: 'running' | 'completed' | 'blocked' | 'cancelled';
  deadlineSeconds: number;
  error: string | null;
}
export interface AuditEvent {
  id: string;
  type: string;
  detail: string;
  createdAt: string;
}
export interface Room {
  schemaVersion: 1;
  id: string;
  title: string;
  objective: string;
  status: RoomStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  maxTurns: number;
  turnsUsed: number;
  agents: Agent[];
  threads: Thread[];
  messages: Message[];
  requests: Request[];
  jobs: Job[];
  snapshots: ContextSnapshot[];
  events: AuditEvent[];
  relays: Relay[];
}
export type RoomSummary = Pick<
  Room,
  'id' | 'title' | 'objective' | 'status' | 'revision' | 'updatedAt'
>;
export interface SendResult {
  messageId: string;
  threadId: string;
  requestId: string | null;
}
