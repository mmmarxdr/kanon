/**
 * Password policy — single source of truth for client-side validation.
 * Constants mirror RegisterBody in packages/api/src/modules/auth/schema.ts.
 */

const MIN = 8; // mirrors RegisterBody (packages/api)
const MAX = 128; // mirrors RegisterBody (packages/api)

export interface Requirement {
  id: "min-length" | "max-length" | "match";
  label: string;
  met: boolean;
}

/**
 * Evaluate password requirements given the password and confirm values.
 * Always returns all three requirements; display filtering is the component's concern.
 */
export function evaluatePassword(password: string, confirm: string): Requirement[] {
  return [
    {
      id: "min-length",
      label: "At least 8 characters",
      met: password.length >= MIN,
    },
    {
      id: "max-length",
      label: "At most 128 characters",
      met: password.length <= MAX,
    },
    {
      id: "match",
      label: "Passwords match",
      met: confirm.length > 0 && password === confirm,
    },
  ];
}

/**
 * Returns true only when every requirement is met.
 */
export function isPasswordValid(requirements: Requirement[]): boolean {
  return requirements.every((r) => r.met);
}
