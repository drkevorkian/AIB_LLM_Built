import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  appSettingsSchema,
  defaultAppSettings,
  type AppSettings,
  type Room,
  type RoomSummary,
} from '../shared/contracts.js';
import { AppError } from './errors.js';

/** Single service writer. The separate SQLite lease releases automatically after a crash. */
export class RoomStore {
  private db: DatabaseSync;
  private lease: DatabaseSync | null = null;
  private closed = false;

  constructor(
    path: string,
    private now: () => Date = () => new Date(),
  ) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      this.lease = new DatabaseSync(`${path}.lock`, { timeout: 100 });
      try {
        this.lease.exec('BEGIN EXCLUSIVE');
      } catch {
        this.lease.close();
        throw new Error('This data directory is already open in another application process.');
      }
    }
    let opened: DatabaseSync | null = null;
    try {
      opened = new DatabaseSync(path, { timeout: 1000 });
      this.db = opened;
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
      if (version > 2) throw new Error('Database schema is newer than this application.');
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS rooms (
          id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL,
          payload TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload TEXT NOT NULL,
          initialized INTEGER NOT NULL DEFAULT 0 CHECK (initialized IN (0, 1))
        ) STRICT;
        PRAGMA user_version = 2;
        COMMIT;
      `);
      this.db
        .prepare('INSERT OR IGNORE INTO settings (id, payload) VALUES (1, ?)')
        .run(JSON.stringify(defaultAppSettings));
    } catch (error) {
      opened?.close();
      this.lease?.close();
      throw error;
    }
  }

  list(): RoomSummary[] {
    return this.all()
      .map(({ id, title, objective, status, archivedAt, revision, updatedAt }) => ({
        id,
        title,
        objective,
        status,
        archivedAt: archivedAt ?? null,
        revision,
        updatedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  all(): Room[] {
    return this.db
      .prepare('SELECT payload FROM rooms ORDER BY rowid')
      .all()
      .map((row) => this.parse(String(row.payload)));
  }

  get(id: string): Room {
    const row = this.db.prepare('SELECT payload FROM rooms WHERE id = ?').get(id);
    if (!row) throw new AppError(404, 'Room not found.');
    return this.parse(String(row.payload));
  }

  create(room: Room): void {
    this.db
      .prepare('INSERT INTO rooms (id, revision, payload) VALUES (?, ?, ?)')
      .run(room.id, room.revision, JSON.stringify(room));
  }

  delete(id: string): void {
    const write = this.db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    if (Number(write.changes) !== 1) throw new AppError(404, 'Workspace not found.');
  }

  settings(): AppSettings {
    return appSettingsSchema.parse(
      JSON.parse(
        String(this.db.prepare('SELECT payload FROM settings WHERE id = 1').get()!.payload),
      ),
    );
  }

  saveSettings(raw: AppSettings): AppSettings {
    const settings = appSettingsSchema.parse(raw);
    this.db.prepare('UPDATE settings SET payload = ? WHERE id = 1').run(JSON.stringify(settings));
    return settings;
  }

  /** Seed a welcome workspace only once; deleting all workspaces must survive restart. */
  initialize(): boolean {
    return (
      Number(
        this.db
          .prepare('UPDATE settings SET initialized = 1 WHERE id = 1 AND initialized = 0')
          .run().changes,
      ) === 1
    );
  }

  mutate<T>(id: string, change: (room: Room) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const room = this.get(id);
      const revision = room.revision;
      const result = change(room);
      room.revision += 1;
      room.updatedAt = this.now().toISOString();
      const write = this.db
        .prepare('UPDATE rooms SET revision = ?, payload = ? WHERE id = ? AND revision = ?')
        .run(room.revision, JSON.stringify(room), room.id, revision);
      if (Number(write.changes) !== 1) throw new AppError(409, 'Room changed; reload and retry.');
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
    this.lease?.close();
  }

  private parse(payload: string): Room {
    const room = JSON.parse(payload) as Room;
    if (room.schemaVersion !== 1 || !Array.isArray(room.jobs) || !Array.isArray(room.snapshots)) {
      throw new Error('Invalid room data or unsupported room schema.');
    }
    // v0.2 adds optional fields; v0.1 records remain usable without rewriting history.
    room.relays ??= [];
    room.discussions ??= [];
    if (!room.agentRevisions) {
      const seen = new Set<string>();
      room.agentRevisions = [];
      for (const agent of [...room.snapshots.flatMap((s) => s.agents), ...room.agents]) {
        const key = `${agent.id}:${agent.configRevision ?? 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        room.agentRevisions.push({ agent: structuredClone(agent), recordedAt: null });
      }
    }
    return room;
  }
}
