import fs from "node:fs";
import http from "node:http";

const portFile = process.argv[2];
if (!portFile) throw new Error("port file argument is required");

const server = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/api/auth/onboard") {
    response.writeHead(404).end();
    return;
  }

  request.resume();
  request.on("end", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing port");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      refreshToken: "release-smoke-refresh-token",
      apiUrl: `http://127.0.0.1:${address.port}`,
      workspace: {
        id: "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
        slug: "release-smoke",
        name: "Release Smoke",
      },
      email: "release-smoke@example.com",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
  });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  fs.writeFileSync(portFile, String(address.port));
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
