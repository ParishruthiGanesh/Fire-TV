import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
    pool: 'forks',
    fileParallelism: false,
    // Keep test databases and uploads out of the development data directory.
    env: {
      ALONGSIDE_DATA_DIR: 'test-tmp',
      ALONGSIDE_AI_PROVIDER: 'local',
      ALONGSIDE_CAREGIVER_TOKEN: 'test-caregiver-token',
    },
  },
});
