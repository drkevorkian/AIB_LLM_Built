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
export const maxParticipants = 8;
export const addAgentSchema = agentSettingsSchema.pick({ name: true, role: true });
export const agentActivationSchema = z.strictObject({ active: z.boolean() });
export type AddAgentInput = z.input<typeof addAgentSchema>;
export type AgentActivationInput = z.input<typeof agentActivationSchema>;
export const createRoomSchema = z.strictObject({
  title: z.string().trim().min(1).max(100),
  objective: z.string().trim().max(3000).default(''),
  maxTurns: z.number().int().min(1).max(1000).default(100),
  participantCount: z.number().int().min(1).max(maxParticipants).default(3),
});
export const appSettingsSchema = z.strictObject({
  defaultMaxTurns: z.number().int().min(1).max(1000),
  defaultDeadlineSeconds: z.number().int().min(5).max(600),
  defaultPolicy: z.enum(['all', 'any', 'quorum']),
  defaultSynthesis: z.boolean(),
  defaultDiscussionRounds: z.number().int().min(1).max(10),
  defaultDiscussionTurns: z.number().int().min(2).max(50),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;
export const defaultAppSettings: AppSettings = {
  defaultMaxTurns: 100,
  defaultDeadlineSeconds: 120,
  defaultPolicy: 'all',
  defaultSynthesis: true,
  defaultDiscussionRounds: 3,
  defaultDiscussionTurns: 12,
};
export const workspaceSettingsSchema = z.strictObject({
  title: z.string().trim().min(1).max(100),
  objective: z.string().trim().max(3000),
  maxTurns: z.number().int().min(1).max(1000),
});
export type WorkspaceSettingsInput = z.infer<typeof workspaceSettingsSchema>;
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
  discussion: z
    .strictObject({
      maxRounds: z.number().int().min(1).max(10),
      maxTurns: z.number().int().min(2).max(50),
    })
    .nullable()
    .default(null),
});
export const agentActionSchema = z.strictObject({
  kind: z.enum(['ask', 'finish']),
  body: z.string().trim().min(1).max(20000),
  recipientIds: z.array(idSchema).max(8),
  policy: z.enum(['all', 'any', 'quorum']),
  quorum: z.number().int().min(1).max(8),
  replyTo: idSchema.nullable(),
});
export type AgentAction = z.infer<typeof agentActionSchema>;
export const stopDiscussionSchema = z.strictObject({ discussionId: idSchema });
export const controlSchema = z.strictObject({ action: z.enum(['pause', 'resume', 'stop']) });
export const retrySchema = z.strictObject({ jobId: idSchema });
export type CreateRoomInput = z.input<typeof createRoomSchema>;
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
  /** Legacy participants are active when this field is absent. */
  active?: boolean;
  color: 'teal' | 'amber' | 'violet';
}
export interface AgentRevision {
  agent: Agent;
  /** null identifies a recovered legacy configuration with no known edit time. */
  recordedAt: string | null;
}
export function isAgentActive(agent: Agent): boolean {
  return agent.active !== false;
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
  messages: (Pick<Message, 'id' | 'authorId' | 'type' | 'body'> & { authorName?: string })[];
  createdAt: string;
  /** Human deletion redacts source copies; these snapshots cannot be reused for retries. */
  deletedMessageIds?: string[];
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
  discussionId?: string;
  phase?: 'decision' | 'consultation';
  sourceRequestId?: string;
}
export interface Job {
  id: string;
  requestId: string;
  agentId: string;
  kind: 'answer' | 'synthesis' | 'decision';
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
  discussionId?: string;
  repairReason?: string;
  agentAction?: AgentAction;
}
export interface Discussion {
  id: string;
  messageId: string;
  threadId: string;
  leaderId: string;
  allowedPeerIds: string[];
  status: 'running' | 'waiting' | 'completed' | 'blocked' | 'cancelled';
  maxRounds: number;
  roundsUsed: number;
  maxTurns: number;
  turnsUsed: number;
  deadlineSeconds: number;
  requestIds: string[];
  roundRequestIds: string[];
  currentRequestId: string;
  resultMessageId: string | null;
  error: string | null;
  askFingerprints: string[];
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
  /** Monotonic even when the most recent thread is deleted. */
  messageSequence?: number;
  /** Minimal replay tombstones retain UUIDs, never deleted text or command hashes. */
  deletedClientIds?: string[];
  agents: Agent[];
  agentRevisions?: AgentRevision[];
  threads: Thread[];
  messages: Message[];
  requests: Request[];
  jobs: Job[];
  snapshots: ContextSnapshot[];
  events: AuditEvent[];
  relays: Relay[];
  discussions: Discussion[];
}
export type RoomSummary = Pick<
  Room,
  'id' | 'title' | 'objective' | 'status' | 'revision' | 'updatedAt'
>;
export interface SendResult {
  messageId: string;
  threadId: string;
  requestId: string | null;
  discussionId?: string;
}

export function agentAtSnapshot(
  room: Pick<Room, 'agents' | 'snapshots'>,
  agentId: string,
  snapshotId?: string | null,
): Agent | undefined {
  return (
    room.snapshots.find((s) => s.id === snapshotId)?.agents.find((a) => a.id === agentId) ??
    room.agents.find((a) => a.id === agentId)
  );
}

export function hasPendingWork(room: Pick<Room, 'jobs' | 'relays' | 'discussions'>): boolean {
  return (
    room.jobs.some((j) => j.status === 'queued' || j.status === 'running') ||
    room.relays.some((r) => r.status === 'running' || r.status === 'blocked') ||
    room.discussions.some((d) => ['running', 'waiting', 'blocked'].includes(d.status))
  );
}

/** Stable roster positions distinguish duplicate display names without changing identity. */
export function agentLabel(
  room: Pick<Room, 'agents' | 'snapshots'>,
  agentId: string,
  snapshotId?: string | null,
): string {
  const roster = room.snapshots.find((s) => s.id === snapshotId)?.agents ?? room.agents;
  const agent = agentAtSnapshot(room, agentId, snapshotId);
  if (!agent) return agentId;
  const position = roster.findIndex((a) => a.id === agentId);
  return position >= 0 && roster.filter((a) => a.name === agent.name).length > 1
    ? `${agent.name} · #${position + 1}`
    : agent.name;
}
