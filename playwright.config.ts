import { defineConfig } from '@playwright/test';

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
    env: { AIB_PORT: '4318', AIB_DATA_DIR: '.data/ui-tests' },
  },
});
