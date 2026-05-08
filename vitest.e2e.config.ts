import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.test.ts"],
    environment: "node",
    globals: true,
    clearMocks: true,
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true
      }
    }
  }
});
