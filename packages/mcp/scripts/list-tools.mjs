#!/usr/bin/env node
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = process.argv[2];
if (!serverPath) throw new Error("Usage: list-tools.mjs <mcp-entry.js>");

const env = Object.fromEntries(
  Object.entries(process.env).filter((entry) => entry[1] !== undefined),
);
env.KANON_API_URL = "http://127.0.0.1:1";
env.KANON_API_KEY = "eyJ.release-smoke";
delete env.KANON_WORKSPACE_ID;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve(serverPath)],
  env,
  stderr: "pipe",
});
const client = new Client({ name: "kanon-release-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const result = await client.listTools();
  process.stdout.write(JSON.stringify(result.tools.map((tool) => tool.name).sort()));
} finally {
  await client.close();
}
