/**
 * Password policy — client-side validation derived from the shared SSOT.
 * All complexity rules come from @kanon/shared/password so this module and
 * the API always enforce the same policy (KAN-50).
 */

import { PASSWORD_REQUIREMENTS, PASSWORD_MAX_LENGTH } from "@kanon/shared";

export interface Requirement {
  id: string;
  label: string;
  met: boolean;
}

/**
 * Evaluate password requirements given the password and confirm values.
 * Returns the 5 shared complexity requirements (derived from PASSWORD_REQUIREMENTS)
 * plus the UI-only max-length guard and match item, in that order.
 * Display filtering is the component's concern.
 */
export function evaluatePassword(password: string, confirm: string): Requirement[] {
  const complexityReqs: Requirement[] = PASSWORD_REQUIREMENTS.map((r) => ({
    id: r.id,
    label: r.label,
    met: r.test(password),
  }));

  return [
    ...complexityReqs,
    {
      id: "max-length",
      label: "At most 128 characters",
      met: password.length <= PASSWORD_MAX_LENGTH,
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
