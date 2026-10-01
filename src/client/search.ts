import type { Room, RoomSummary, Thread } from '../shared/contracts.js';

export type WorkspaceView = 'active' | 'archived' | 'all';

/** Search only the room-visible records already authorized and loaded by the service. */
export function searchWorkspaces(
  rooms: RoomSummary[],
  query: string,
  view: WorkspaceView,
): RoomSummary[] {
  const term = query.trim().toLocaleLowerCase();
  return rooms.filter(
    (room) =>
      (view === 'all' || Boolean(room.archivedAt) === (view === 'archived')) &&
      (!term || `${room.title}\n${room.objective}`.toLocaleLowerCase().includes(term)),
  );
}

export function searchThreads(
  room: Pick<Room, 'threads' | 'messages'>,
  query: string,
): { thread: Thread; snippet: string | null }[] {
  const term = query.trim().toLocaleLowerCase();
  const matches = new Map<string, string>();
  if (term) {
    const ids = new Set(room.threads.map((thread) => thread.id));
    for (const message of room.messages) {
      if (!ids.has(message.threadId) || matches.has(message.threadId)) continue;
      const index = message.body.toLocaleLowerCase().indexOf(term);
      if (index < 0) continue;
      const start = Math.max(0, index - 36);
      const end = Math.min(message.body.length, index + term.length + 64);
      matches.set(
        message.threadId,
        `${start ? '…' : ''}${message.body.slice(start, end)}${end < message.body.length ? '…' : ''}`,
      );
    }
  }
  return room.threads.flatMap((thread) => {
    const snippet = matches.get(thread.id) ?? null;
    return !term || thread.title.toLocaleLowerCase().includes(term) || snippet !== null
      ? [{ thread, snippet }]
      : [];
  });
}
