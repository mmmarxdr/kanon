import { env } from "../../config/env.js";
import { ResendProvider } from "./resend-provider.js";
import { ConsoleProvider } from "./console-provider.js";
import type { EmailProvider, EmailMessage } from "./types.js";

export type { EmailProvider, EmailMessage };

/**
 * Create an email provider based on environment configuration.
 * Returns ResendProvider if RESEND_API_KEY is set, ConsoleProvider otherwise.
 */
export function createEmailProvider(): EmailProvider {
  if (env.RESEND_API_KEY) {
    return new ResendProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
  }
  return new ConsoleProvider();
}
