export type Creds = {
  server: string;
  refreshToken: string;
  email: string;
  savedAt: string;
};

export interface CredentialStore {
  readCredentials(server: string): Promise<Creds | null>;
  writeCredentials(server: string, creds: Creds): Promise<void>;
  clearCredentials(server: string): Promise<void>;
  /**
   * Return all server keys currently stored.
   * Returns an empty array when no credentials exist or on any read error.
   */
  listServers(): Promise<string[]>;
}
