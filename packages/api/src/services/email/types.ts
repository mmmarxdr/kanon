export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Return type for email builder functions (templates).
 * Defined once here to avoid duplication across template files.
 */
export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}
