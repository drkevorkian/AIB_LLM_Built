import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Only the main Playwright process starts this server. Each run gets a new database.
const dataDirectory = join(tmpdir(), `aib-ui-${randomUUID()}`);

export default defineConfig({
  testDir: 'tests/ui',
  timeout: 20000,
  use: {
    baseURL: 'http://127.0.0.1:4318',
    browserName: 'chromium',
    headless: true,
    launchOptions: process.env.AIB_BROWSER_PATH
      ? {
          executablePath: process.env.AIB_BROWSER_PATH,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        }
      : {},
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4318/api/session',
    reuseExistingServer: false,
    env: {
      AIB_PORT: '4318',
      AIB_DATA_DIR: dataDirectory,
      OPENAI_API_KEY: '',
      XAI_API_KEY: '',
      GEMINI_API_KEY: '',
      AIB_COMPATIBLE_API_KEY: '',
    },
  },
});
