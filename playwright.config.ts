import { defineConfig } from '@playwright/test';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve('.cache/playwright');
export default defineConfig({
  testDir: './tests/browser', timeout: 45000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4317', viewport: { width: 1440, height: 1100 }, trace: 'retain-on-failure' },
  webServer: { command: 'node dist/server/index.js', url: 'http://127.0.0.1:4317/api/health', reuseExistingServer: false, env: { PORT: '4317', SCOUT_DATA_DIR: '.cache/browser-data' } },
});
