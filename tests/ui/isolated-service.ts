import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

/** A real production-service restart with data and credentials isolated from the developer. */
export async function isolatedService(page: Page) {
  const directory = await mkdtemp(join(tmpdir(), 'aib-ui-archive-'));
  const socket = createServer();
  await new Promise<void>((done) => socket.listen(0, '127.0.0.1', done));
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable');
  const port = address.port;
  await new Promise<void>((done) => socket.close(() => done()));
  const base = `http://127.0.0.1:${port}`;
  const start = () =>
    spawn(process.execPath, ['dist/server/server/main.js'], {
      env: {
        ...process.env,
        AIB_PORT: String(port),
        AIB_DATA_DIR: directory,
        OPENAI_API_KEY: '',
        XAI_API_KEY: '',
        GEMINI_API_KEY: '',
        AIB_COMPATIBLE_API_KEY: '',
      },
      stdio: 'ignore',
    });
  let processHandle = start();
  async function ready() {
    await expect
      .poll(
        async () => {
          try {
            return (await page.request.get(base + '/api/session')).status();
          } catch {
            return 0;
          }
        },
        { timeout: 10000 },
      )
      .toBe(200);
  }
  async function stop() {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
    const exited = new Promise<void>((done) => processHandle.once('exit', () => done()));
    processHandle.kill('SIGTERM');
    await exited;
  }
  return {
    base,
    ready,
    restart: async () => {
      await stop();
      processHandle = start();
      await ready();
    },
    close: async () => {
      await stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
