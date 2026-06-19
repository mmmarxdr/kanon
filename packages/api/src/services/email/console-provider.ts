import type { EmailMessage, EmailProvider } from "./types.js";

export class ConsoleProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    console.log("═".repeat(60));
    console.log("📧 EMAIL (console provider — no RESEND_API_KEY configured)");
    console.log("═".repeat(60));
    console.log(`  To:      ${message.to}`);
    console.log(`  Subject: ${message.subject}`);
    console.log("─".repeat(60));

    // Extract and highlight any action URL for easy copy-paste in dev
    const resetMatch = message.html.match(/href="([^"]*reset-password[^"]*)"/);
    if (resetMatch) {
      console.log("");
      console.log(`  🔗 Reset URL: ${resetMatch[1]}`);
      console.log("");
    }

    const magicMatch = message.html.match(/href="([^"]*magic-link[^"]*)"/);
    if (magicMatch) {
      console.log("");
      console.log(`  🔗 Magic Link URL: ${magicMatch[1]}`);
      console.log("");
    }

    if (message.text) {
      console.log("  Text:");
      console.log(`  ${message.text}`);
    } else {
      console.log("  HTML:");
      console.log(`  ${message.html}`);
    }

    console.log("═".repeat(60));
  }
}
