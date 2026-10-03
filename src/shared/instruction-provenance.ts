import type { ContextSnapshot, Message, Room } from './contracts.js';

export type InstructionState = 'current' | 'stale' | 'unknown';
interface InstructionComparison {
  state: InstructionState;
  frozenRevision: number | null;
  currentRevision: number | null;
  reason:
    | 'revision'
    | 'objective'
    | 'instructions'
    | 'role'
    | 'role-history'
    | 'missing'
    | 'inconsistent';
}
export interface InstructionProvenance {
  state: InstructionState;
  workspace: InstructionComparison;
  role: InstructionComparison;
}

function revision(value: number | undefined): number | null {
  return Number.isSafeInteger(value) && value! >= 0 ? value! : null;
}
function workspaceInstructions(room: Room, snapshot?: ContextSnapshot): InstructionComparison {
  const frozenRevision = revision(snapshot?.instructionRevision);
  const currentRevision = revision(room.instructionRevision ?? 0);
  const base = { frozenRevision, currentRevision };
  if (!snapshot || currentRevision === null || typeof snapshot.objective !== 'string')
    return { ...base, state: 'unknown', reason: 'missing' };
  if (
    typeof room.objective !== 'string' ||
    (room.humanInstructions !== undefined && typeof room.humanInstructions !== 'string') ||
    (snapshot.humanInstructions !== undefined && typeof snapshot.humanInstructions !== 'string')
  )
    return { ...base, state: 'unknown', reason: 'inconsistent' };
  if (snapshot.instructionRevision !== undefined && frozenRevision === null)
    return { ...base, state: 'unknown', reason: 'inconsistent' };
  if (frozenRevision !== null) {
    if (frozenRevision < currentRevision) return { ...base, state: 'stale', reason: 'revision' };
    if (frozenRevision > currentRevision)
      return { ...base, state: 'unknown', reason: 'inconsistent' };
    if (snapshot.humanInstructions === undefined)
      return { ...base, state: 'unknown', reason: 'missing' };
    if (
      snapshot.objective !== room.objective ||
      snapshot.humanInstructions !== (room.humanInstructions ?? '')
    )
      return { ...base, state: 'unknown', reason: 'inconsistent' };
    return { ...base, state: 'current', reason: 'revision' };
  }
  // A legacy field can prove a difference, but matching text cannot invent a missing revision.
  if (snapshot.objective !== room.objective)
    return { ...base, state: 'stale', reason: 'objective' };
  if (
    snapshot.humanInstructions !== undefined &&
    snapshot.humanInstructions !== (room.humanInstructions ?? '')
  )
    return { ...base, state: 'stale', reason: 'instructions' };
  return { ...base, state: 'unknown', reason: 'missing' };
}
function participantRole(
  room: Room,
  snapshot: ContextSnapshot | undefined,
  agentId: string,
): InstructionComparison {
  const frozen = snapshot?.agents.find((agent) => agent.id === agentId);
  const current = room.agents.find((agent) => agent.id === agentId);
  const frozenRevision = revision(frozen?.configRevision);
  const currentRevision = revision(current?.configRevision);
  const base = { frozenRevision, currentRevision };
  if (!frozen || !current || typeof frozen.role !== 'string' || typeof current.role !== 'string')
    return { ...base, state: 'unknown', reason: 'missing' };
  if (frozen.role !== current.role) return { ...base, state: 'stale', reason: 'role' };
  if (frozenRevision === null || currentRevision === null)
    return { ...base, state: 'unknown', reason: 'missing' };
  if (frozenRevision > currentRevision)
    return { ...base, state: 'unknown', reason: 'inconsistent' };
  if (frozenRevision === currentRevision) return { ...base, state: 'current', reason: 'revision' };
  const history = (room.agentRevisions ?? []).filter(({ agent }) => {
    const at = revision(agent.configRevision);
    return (
      agent.id === agentId &&
      typeof agent.role === 'string' &&
      at !== null &&
      at > frozenRevision &&
      at <= currentRevision
    );
  });
  const recorded = new Map<number, string>();
  for (const { agent } of history) {
    const at = agent.configRevision!;
    if (recorded.has(at) && recorded.get(at) !== agent.role)
      return { ...base, state: 'unknown', reason: 'inconsistent' };
    recorded.set(at, agent.role);
  }
  if ([...recorded.values()].some((role) => role !== frozen.role))
    return { ...base, state: 'stale', reason: 'role-history' };
  // Count recorded revisions rather than iterating an untrusted numeric range.
  return recorded.size === currentRevision - frozenRevision
    ? { ...base, state: 'current', reason: 'revision' }
    : { ...base, state: 'unknown', reason: 'missing' };
}

/** Read-only comparison of frozen instructions with current retained settings; never scheduling authority. */
export function invocationInstructionProvenance(
  room: Room,
  snapshot: ContextSnapshot | undefined,
  agentId: string,
): InstructionProvenance {
  const workspace = workspaceInstructions(room, snapshot);
  const role = participantRole(room, snapshot, agentId);
  const states = [workspace.state, role.state];
  return {
    state: states.includes('stale') ? 'stale' : states.includes('unknown') ? 'unknown' : 'current',
    workspace,
    role,
  };
}
export function messageInstructionProvenance(
  room: Room,
  message: Message,
): InstructionProvenance | null {
  if (message.authorId === 'human' || message.authorId === 'system') return null;
  return invocationInstructionProvenance(
    room,
    room.snapshots.find((snapshot) => snapshot.id === message.snapshotId),
    message.authorId,
  );
}
export function instructionProvenanceLabel(provenance: InstructionProvenance): string {
  return provenance.state === 'stale'
    ? 'Stale instructions'
    : provenance.state === 'unknown'
      ? 'Instruction provenance unknown'
      : 'Instructions current';
}
export function instructionProvenanceDetails(provenance: InstructionProvenance): string[] {
  const details: string[] = [];
  const { workspace, role } = provenance;
  if (workspace.state === 'stale') {
    details.push(
      workspace.reason === 'revision'
        ? `Workspace instruction revision ${workspace.frozenRevision} was superseded by revision ${workspace.currentRevision}.`
        : workspace.reason === 'objective'
          ? 'The recorded shared objective differs from the current objective.'
          : 'The recorded workspace instructions differ from the current instructions.',
    );
  } else if (workspace.state === 'unknown') {
    details.push(
      workspace.reason === 'inconsistent'
        ? 'Workspace instruction records are inconsistent; their revision relationship is unknown.'
        : 'Workspace instruction text or revision was not fully recorded; its provenance is unknown.',
    );
  }
  if (role.state === 'stale') {
    details.push(
      role.reason === 'role-history'
        ? `Participant role instructions were superseded after configuration ${role.frozenRevision}, even though the current role text matches again.`
        : 'The recorded participant role differs from its current role instructions.',
    );
  } else if (role.state === 'unknown') {
    details.push(
      role.reason === 'inconsistent'
        ? 'Participant configuration revisions are inconsistent; role supersession is unknown.'
        : 'Participant role revision history is incomplete; role supersession is unknown.',
    );
  }
  if (provenance.state === 'current')
    details.push(
      `Workspace instruction revision ${workspace.frozenRevision} and the recorded role match current instruction records.`,
    );
  return details;
}
