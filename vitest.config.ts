import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  },
  resolve: {
    alias: [
      { find: "@6esk/auth/cloudflare-access", replacement: path.resolve(__dirname, "packages/auth/src/cloudflare-access.ts") },
      { find: "@6esk/types/backoffice", replacement: path.resolve(__dirname, "packages/types/src/backoffice.ts") },
      { find: "@6esk/auth", replacement: path.resolve(__dirname, "packages/auth/src/index.ts") },
      { find: "@6esk/database", replacement: path.resolve(__dirname, "packages/database/src/index.ts") },
      { find: "@6esk/types", replacement: path.resolve(__dirname, "packages/types/src/index.ts") },
      { find: "@6esk/ui", replacement: path.resolve(__dirname, "packages/ui/src/index.tsx") },
      { find: "@", replacement: path.resolve(__dirname, "src") }
    ]
  }
});
