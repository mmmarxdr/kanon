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
}
