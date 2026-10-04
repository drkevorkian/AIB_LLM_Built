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
export const contextPolicySchema = z.strictObject({
  maxCharacters: z.number().int().min(4096).max(262144),
  overflow: z.enum(['reject', 'trim_oldest']),
});
export type ContextPolicy = z.infer<typeof contextPolicySchema>;
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
  /** Omission preserves a same-model policy; null explicitly returns to legacy limits. */
  contextPolicy: contextPolicySchema.nullable().optional(),
});
export const connectionTestSchema = z.strictObject({
  agentId: idSchema,
  kind: z.enum(['greeting', 'coordinator']).default('greeting'),
});
export type ConnectionTestKind = z.infer<typeof connectionTestSchema>['kind'];
export interface ConnectionTestResult {
  kind: ConnectionTestKind;
  reply: string;
  provider: ProviderKind;
  model: string;
  configRevision: number;
  testedAt: string;
}
export const maxParticipants = 8;
export const maxConcurrentRequests = 4;
const requestLimitSchema = z.number().int().min(1).max(maxConcurrentRequests);
export const providerConcurrencySchema = z.strictObject({
  simulated: requestLimitSchema,
  openai: requestLimitSchema,
  xai: requestLimitSchema,
  gemini: requestLimitSchema,
  ollama: requestLimitSchema,
  'openai-compatible': requestLimitSchema,
});
export type ProviderConcurrency = z.infer<typeof providerConcurrencySchema>;
export const defaultProviderConcurrency: ProviderConcurrency = {
  simulated: 4,
  openai: 4,
  xai: 4,
  gemini: 4,
  ollama: 4,
  'openai-compatible': 4,
};
export const addAgentSchema = agentSettingsSchema.pick({ name: true, role: true });
export const agentActivationSchema = z.strictObject({ active: z.boolean() });
export const agentRemovalSchema = z.strictObject({
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type AddAgentInput = z.input<typeof addAgentSchema>;
export type AgentActivationInput = z.input<typeof agentActivationSchema>;
export type AgentRemovalInput = z.input<typeof agentRemovalSchema>;
export const createRoomSchema = z.strictObject({
  title: z.string().trim().min(1).max(100),
  objective: z.string().trim().max(3000).default(''),
  humanInstructions: z.string().max(3000).default(''),
  maxTurns: z.number().int().min(1).max(1000).default(100),
  maxConcurrentRequests: requestLimitSchema.default(maxConcurrentRequests),
  participantCount: z.number().int().min(1).max(maxParticipants).default(3),
});
export const appSettingsSchema = z.strictObject({
  defaultMaxTurns: z.number().int().min(1).max(1000),
  defaultDeadlineSeconds: z.number().int().min(5).max(600),
  defaultPolicy: z.enum(['all', 'any', 'quorum']),
  defaultSynthesis: z.boolean(),
  defaultDiscussionRounds: z.number().int().min(1).max(10),
  defaultDiscussionTurns: z.number().int().min(2).max(50),
  providerConcurrency: providerConcurrencySchema.default(defaultProviderConcurrency),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;
export const defaultAppSettings: AppSettings = {
  defaultMaxTurns: 100,
  defaultDeadlineSeconds: 120,
  defaultPolicy: 'all',
  defaultSynthesis: true,
  defaultDiscussionRounds: 3,
  defaultDiscussionTurns: 12,
  providerConcurrency: { ...defaultProviderConcurrency },
};
export const workspaceSettingsSchema = z.strictObject({
  title: z.string().trim().min(1).max(100),
  objective: z.string().trim().max(3000),
  humanInstructions: z.string().max(3000).default(''),
  expectedInstructionRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  maxTurns: z.number().int().min(1).max(1000),
  maxConcurrentRequests: requestLimitSchema.default(maxConcurrentRequests),
});
export type WorkspaceSettingsInput = z.input<typeof workspaceSettingsSchema>;
export const workspaceArchiveSchema = z.strictObject({ archived: z.boolean() });
export type WorkspaceArchiveInput = z.infer<typeof workspaceArchiveSchema>;
export const maxBulkWorkspaces = 25;
export const bulkWorkspaceSchema = z.strictObject({
  action: z.enum(['archive', 'restore', 'delete']),
  roomIds: z
    .array(idSchema)
    .min(1)
    .max(maxBulkWorkspaces)
    .refine((ids) => new Set(ids).size === ids.length, 'Select each workspace only once.'),
});
export const bulkWorkspaceTokenSchema = z.strictObject({ token: z.string().uuid() });
export type BulkWorkspaceInput = z.infer<typeof bulkWorkspaceSchema>;
export interface BulkWorkspacePreview {
  token: string;
  action: BulkWorkspaceInput['action'];
  expiresAt: string;
  targets: {
    id: string;
    title: string;
    revision: number;
    archived: boolean;
    threads: number;
    messages: number;
    queued: number;
    running: number;
    workflows: number;
    probes: number;
    transports: number;
    turnsUsed: number;
    unchanged: boolean;
    blockedReason: string | null;
  }[];
}
export interface BulkWorkspaceResult {
  action: BulkWorkspaceInput['action'];
  roomIds: string[];
}
export const threadSettingsSchema = z.strictObject({
  title: z.string().trim().min(1).max(100),
});
export type ThreadSettingsInput = z.infer<typeof threadSettingsSchema>;
export const sendSchema = z.strictObject({
  clientId: z.string().uuid(),
  body: z.string().trim().min(1).max(12000),
  type: z.enum(['question', 'update', 'interjection']),
  recipientIds: z.array(idSchema).max(8),
  policy: z.enum(['all', 'any', 'quorum', 'deadline', 'no_reply']).default('all'),
  quorum: z.number().int().min(1).max(8).default(1),
  minimumAnswers: z.number().int().min(1).max(8).default(1),
  onTimeout: z.enum(['pause', 'wait', 'incomplete']).default('pause'),
  remainingWork: z.enum(['continue', 'cancel']).default('continue'),
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
  interjection: z
    .strictObject({
      priority: z.enum(['normal', 'urgent']),
      dispatchPolicy: z.enum(['record_only', 'pause']),
    })
    .nullable()
    .default(null),
  context: z
    .strictObject({
      summaryId: idSchema,
      sourceIds: z
        .array(idSchema)
        .max(50)
        .refine((ids) => new Set(ids).size === ids.length),
    })
    .optional(),
});
export const contextSummarySchema = z.strictObject({
  clientId: z.string().uuid(),
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  threadId: idSchema,
  sourceIds: z
    .array(idSchema)
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length),
  title: z.string().trim().min(1).max(100),
  overview: z
    .string()
    .min(1)
    .max(4000)
    .refine((value) => Boolean(value.trim())),
  disagreements: z
    .string()
    .min(1)
    .max(3000)
    .refine((value) => Boolean(value.trim())),
  openQuestions: z
    .string()
    .min(1)
    .max(3000)
    .refine((value) => Boolean(value.trim())),
});
export type ContextSummaryInput = z.infer<typeof contextSummarySchema>;
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
export const updatedSynthesisSchema = z.strictObject({
  clientId: z.string().uuid(),
  requestId: idSchema,
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type UpdatedSynthesisInput = z.infer<typeof updatedSynthesisSchema>;
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
  contextPolicy?: ContextPolicy;
  configRevision?: number;
  /** Legacy participants are active when this field is absent. */
  active?: boolean;
  /** Removal retires invocation eligibility permanently, retaining attribution and history. */
  removedAt?: string;
  /** Application-assigned ordinal; removed identities never release or reuse this number. */
  rosterNumber?: number;
  color: 'teal' | 'amber' | 'violet';
}
export interface AgentRevision {
  agent: Agent;
  /** null identifies a recovered legacy configuration with no known edit time. */
  recordedAt: string | null;
}
export function isAgentActive(agent: Agent): boolean {
  return !isAgentRemoved(agent) && agent.active !== false;
}
export function isAgentRemoved(agent: Agent): boolean {
  return Boolean(agent.removedAt);
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
  type: 'question' | 'update' | 'interjection' | 'answer' | 'synthesis';
  body: string;
  status: MessageStatus;
  replyTo: string | null;
  requestId: string | null;
  snapshotId: string | null;
  createdAt: string;
  clientId?: string;
  commandHash?: string;
  /** Human-authored control record; observed IDs do not revise existing obligations. */
  interjection?: {
    priority: 'normal' | 'urgent';
    dispatchPolicy: 'record_only' | 'pause';
    queuedJobIds: string[];
    runningJobIds: string[];
  };
}
export interface ContextSnapshot {
  id: string;
  sequence: number;
  objective: string;
  /** Legacy snapshots retain unknown instruction provenance; never fill from current settings. */
  humanInstructions?: string;
  instructionRevision?: number;
  agents: Agent[];
  messages: (Pick<Message, 'id' | 'authorId' | 'type' | 'body'> & { authorName?: string })[];
  createdAt: string;
  /** Human deletion redacts source copies; these snapshots cannot be reused for retries. */
  deletedMessageIds?: string[];
  /** Application-owned facts frozen with a synthesis; late results cannot rewrite them. */
  collection?: CollectionContext;
  memory?: SummaryContext;
  delivery?: ContextDelivery;
}
export interface SummarySource {
  id: string;
  authorId: string;
  authorName: string;
  sequence: number;
  type: Message['type'];
  sha256: string;
  excerpt: string;
  truncated: boolean;
  decision?: Omit<AgentAction, 'body'>;
}
export interface SummaryContext {
  id: string;
  title: string;
  threadId: string;
  overview: string;
  disagreements: string;
  openQuestions: string;
  sources: SummarySource[];
  retrievedSourceIds: string[];
  createdAt: string;
  invalidatedAt?: string;
}
export interface ContextSummary extends SummaryContext {
  clientId: string;
  commandHash: string;
}
export interface ContextDelivery {
  agentId: string;
  provider: ProviderKind;
  model: string;
  maxCharacters: number;
  measuredCharacters: number;
  overflow: ContextPolicy['overflow'];
  omittedMessageIds: string[];
}
export interface ContextCursor {
  agentId: string;
  threadId: string;
  deliveryNumber: number;
  jobId: string;
  snapshotId: string;
  provider: ProviderKind;
  model: string;
  sourceSequence: number;
  messageIds: string[];
  summarySourceIds: string[];
  retrievedSourceIds: string[];
  omittedMessageIds: string[];
  preparedAt: string;
  deletedSourceIds?: string[];
}
export interface SummaryOriginal extends SummarySource {
  summaryId: string;
  body: string;
}
export interface CollectionContext {
  requestId: string;
  policy: Request['policy'];
  reason: 'threshold' | 'deadline' | 'incomplete_timeout' | 'updated_synthesis';
  incomplete: boolean;
  expectedRecipientIds: string[];
  includedMessageIds: string[];
  missingRespondents: { agentId: string; status: JobStatus | 'missing' }[];
  /** Preserve source differences; the application does not claim semantic agreement detection. */
  disagreementPolicy: 'preserve_and_identify';
}
export interface Request {
  id: string;
  messageId: string;
  threadId: string;
  recipientIds: string[];
  policy: 'all' | 'any' | 'quorum' | 'deadline';
  quorum: number;
  /** Additive fields: absent legacy values retain pause/continue/minimum-one behavior. */
  minimumAnswers?: number;
  onTimeout?: 'pause' | 'wait' | 'incomplete';
  remainingWork?: 'continue' | 'cancel';
  waitingSince?: string;
  collection?: CollectionContext;
  synthesisRevisionOf?: string;
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
  humanInstructions?: string;
  instructionRevision?: number;
  instructionRevisions?: WorkspaceInstructionRevision[];
  status: RoomStatus;
  /** Archived workspaces retain their history and cannot schedule work. Legacy absence means open. */
  archivedAt?: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  maxTurns: number;
  turnsUsed: number;
  /** Legacy absence uses the service maximum of four managed requests. */
  maxConcurrentRequests?: number;
  /** Monotonic even when the most recent thread is deleted. */
  messageSequence?: number;
  /** Minimal replay tombstones retain UUIDs, never deleted text or command hashes. */
  deletedClientIds?: string[];
  agents: Agent[];
  agentRevisions?: AgentRevision[];
  contextSummaries?: ContextSummary[];
  contextCursors?: ContextCursor[];
  contextDeliveryNumber?: number;
  threads: Thread[];
  messages: Message[];
  requests: Request[];
  jobs: Job[];
  snapshots: ContextSnapshot[];
  events: AuditEvent[];
  relays: Relay[];
  discussions: Discussion[];
}
export interface WorkspaceInstructionRevision {
  revision: number;
  objective: string;
  humanInstructions: string;
  recordedAt: string | null;
  source: 'created' | 'edited' | 'recovered';
}
/** Recover only the known current legacy settings, without inventing old edits or timestamps. */
export function workspaceInstructionHistory(
  room: Pick<
    Room,
    'objective' | 'humanInstructions' | 'instructionRevision' | 'instructionRevisions'
  >,
): WorkspaceInstructionRevision[] {
  return (
    room.instructionRevisions ?? [
      {
        revision: room.instructionRevision ?? 0,
        objective: room.objective,
        humanInstructions: room.humanInstructions ?? '',
        recordedAt: null,
        source: 'recovered',
      },
    ]
  );
}
export type RoomSummary = Pick<
  Room,
  'id' | 'title' | 'objective' | 'status' | 'archivedAt' | 'revision' | 'updatedAt'
>;
export interface SendResult {
  messageId: string;
  threadId: string;
  requestId: string | null;
  discussionId?: string;
}

/** Transient inspection data; never stored in a room or used to authorize dispatch. */
export type QueueBlocker =
  | 'workspace_archived'
  | 'workspace_paused'
  | 'workspace_stopped'
  | 'service_stopping'
  | 'participant_inactive'
  | 'participant_busy'
  | 'connection_check'
  | 'earlier_job'
  | 'service_capacity'
  | 'workspace_capacity'
  | 'provider_capacity'
  | 'turn_limit'
  | 'deadline_elapsed'
  | 'discussion_closed'
  | 'discussion_turn_limit';
export interface ActivityJob {
  jobId: string;
  requestId: string;
  threadId: string;
  threadTitle: string | null;
  kind: Job['kind'];
  provider: ProviderKind | null;
  model: string | null;
  createdAt: string;
  startedAt: string | null;
  deadlineAt: string | null;
}
export interface QueuedActivityJob extends ActivityJob {
  position: number;
  blockers: QueueBlocker[];
}
export interface ResponsePrerequisite {
  requestId: string;
  threadId: string;
  threadTitle: string | null;
  kind: 'synthesis' | 'coordinator';
  status: 'collecting' | 'unresolved';
  policy: Request['policy'];
  received: number;
  required: number;
  deadlineAt: string | null;
  waitingSince?: string;
  respondents: { agentId: string; name: string; status: JobStatus | 'missing' }[];
}
export interface ParticipantActivity {
  agentId: string;
  checkingConnection: boolean;
  /** A completed/aborted generation may still occupy a slot during transport cleanup. */
  finishing: boolean;
  running: ActivityJob[];
  queued: QueuedActivityJob[];
  prerequisites: ResponsePrerequisite[];
}
export interface RoomActivity {
  roomId: string;
  roomRevision: number;
  observedAt: string;
  capacity: { inUse: number; limit: number };
  workspaceCapacity: { inUse: number; limit: number };
  providerCapacity: { provider: ProviderKind; inUse: number; limit: number }[];
  participants: ParticipantActivity[];
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

export function hasPendingWork(
  room: Pick<Room, 'jobs' | 'relays' | 'discussions'> & { requests?: Request[] },
): boolean {
  return (
    room.jobs.some((j) => j.status === 'queued' || j.status === 'running') ||
    room.relays.some((r) => r.status === 'running' || r.status === 'blocked') ||
    room.discussions.some((d) => ['running', 'waiting', 'blocked'].includes(d.status)) ||
    (room.requests ?? []).some(collectionPending)
  );
}

/** Pending timed collection can outlive its jobs; it must retain settings/archive guards. */
export function collectionPending(request: Request): boolean {
  return (
    (request.status === 'collecting' || request.status === 'unresolved') &&
    (request.policy === 'deadline' ||
      request.onTimeout === 'incomplete' ||
      request.onTimeout === 'wait' ||
      !!request.waitingSince)
  );
}
export function collectionTarget(request: Request): number {
  return request.policy === 'all'
    ? request.recipientIds.length
    : request.policy === 'any'
      ? 1
      : request.policy === 'deadline'
        ? (request.minimumAnswers ?? 1)
        : request.quorum;
}
export function collectionDeadlineActive(request: Request): boolean {
  return !request.waitingSince && (request.status === 'collecting' || collectionPending(request));
}

/** Stable roster positions distinguish duplicate display names without changing identity. */
export function agentLabel(
  room: Pick<Room, 'agents' | 'snapshots'>,
  agentId: string,
  snapshotId?: string | null,
): string {
  const roster =
    room.snapshots.find((s) => s.id === snapshotId)?.agents ??
    room.agents.filter((a) => !isAgentRemoved(a));
  const agent = agentAtSnapshot(room, agentId, snapshotId);
  if (!agent) return agentId;
  const position = roster.findIndex((a) => a.id === agentId);
  return position >= 0 && roster.filter((a) => a.name === agent.name).length > 1
    ? `${agent.name} · #${agent.rosterNumber ?? position + 1}`
    : agent.name;
}
