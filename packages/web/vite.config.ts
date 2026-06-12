import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

const DEV_INFO_DIR = path.resolve(process.cwd(), ".dev-info");
const DEV_INFO_FILE = path.join(DEV_INFO_DIR, "web.json");
const DEV_INFO_TMP = path.join(DEV_INFO_DIR, "web.json.tmp");

/**
 * Inline plugin that writes .dev-info/web.json after Vite binds to its port.
 * Atomic write (tmp → rename) prevents partial reads by dev-start.sh poll.
 */
function writeDevInfo(): Plugin {
  return {
    name: "kanon-dev-info",
    configureServer(server) {
      server.httpServer?.on("listening", () => {
        const addr = server.httpServer!.address();
        if (typeof addr === "object" && addr !== null) {
          try {
            fs.mkdirSync(DEV_INFO_DIR, { recursive: true });
            const info = {
              service: "web",
              port: addr.port,
              host: addr.address,
              url: `http://${addr.address === "0.0.0.0" ? "localhost" : addr.address}:${addr.port}`,
              pid: process.pid,
              startedAt: new Date().toISOString(),
            };
            fs.writeFileSync(DEV_INFO_TMP, JSON.stringify(info, null, 2));
            fs.renameSync(DEV_INFO_TMP, DEV_INFO_FILE);
          } catch {
            // Non-fatal — dev-info is best-effort
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    writeDevInfo(),
    // Upload source maps to Sentry on build so stack traces are readable.
    // Active only when an auth token is present (CI), so local builds without
    // the secret are unaffected. Must come after the other plugins.
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG ?? "marc-dechand",
            project: process.env.SENTRY_PROJECT ?? "kanon",
            authToken: process.env.SENTRY_AUTH_TOKEN,
            // Delete the .map files from the client output after upload so the
            // source is never served publicly (multi-tenant app).
            sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
          }),
        ]
      : []),
  ],
  build: {
    // "hidden" generates source maps for Sentry to symbolicate but does NOT
    // add a public //# sourceMappingURL reference to the bundle.
    sourcemap: "hidden",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: Number(process.env.KANON_WEB_PORT) || 5173,
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
