import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { RoomStore } from './store.js';
import { ConversationEngine } from './engine.js';
import { LiveProviders } from './live-providers.js';
import { serve } from './http.js';

const defaultData =
  process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? homedir(), 'AIB_LLM_Built')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'AIB_LLM_Built')
      : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'AIB_LLM_Built');
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(process.env.AIB_PORT ?? 4317);
const dataDir = resolve(process.env.AIB_DATA_DIR ?? defaultData);
const store = new RoomStore(join(dataDir, 'rooms.sqlite'));
const engine = new ConversationEngine(store, new LiveProviders());
if (!store.list().length) {
  engine.createRoom({
    title: 'The first conversation',
    objective: 'Explore an idea with independent perspectives, then bring the answers together.',
    maxTurns: 100,
  });
}
let app: Awaited<ReturnType<typeof serve>>;
try {
  app = await serve(engine, {
    port,
    clientDir: resolve('dist/client'),
    dev: process.argv.includes('--dev'),
  });
} catch (error) {
  engine.close();
  store.close();
  throw error;
}
console.log(
  `\nAI Conversation Room v0.3.0\nOpen http://127.0.0.1:${app.port}\nConfigure each participant to use a live provider or simulation.\nData: ${dataDir}\nWork continues while this service is running. Pause or stop before closing a view.\n`,
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  engine.close();
  await app.close();
  store.close();
}
process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});
