// ─── Auth Resolution ─────────────────────────────────────────────────────────

import readline from "node:readline";

interface AuthResult {
  apiUrl: string;
  apiKey: string;
}

/**
 * Resolve API URL and key with precedence: CLI flags > env vars > interactive prompt.
 * apiUrl is required; apiKey is optional (some setups don't need it).
 */
export async function resolveAuth(options: {
  apiUrl?: string;
  apiKey?: string;
}): Promise<AuthResult> {
  let apiUrl = options.apiUrl || process.env["KANON_API_URL"] || "";
  let apiKey = options.apiKey || process.env["KANON_API_KEY"] || "";

  if (!apiUrl) {
    apiUrl = await prompt("Kanon API URL: ");
  }

  if (!apiUrl) {
    throw new Error(
      "API URL is required. Provide via --api-url, KANON_API_URL env var, or enter it when prompted.",
    );
  }

  if (!apiKey) {
    apiKey = await prompt("Kanon API Key (press Enter to skip): ");
  }

  return { apiUrl, apiKey };
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
