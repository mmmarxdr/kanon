import { z } from "zod";

/**
 * Password policy — single source of truth shared across backend and frontend.
 *
 * Rules (KAN-49 / KAN-50): minimum 12 characters, maximum 128, with at least
 * one uppercase letter, one lowercase letter, one digit, and one symbol.
 *
 * Applied uniformly to every flow that sets a password: register, instance
 * setup (claim), reset-password and change-password. Both the API (Zod body
 * validation) and the web client (requirement checklist) derive from this
 * module so users see consistent rules regardless of entry point.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one digit")
  // Whitespace is not a symbol — \s is excluded so a stray space can't satisfy
  // the complexity requirement on its own.
  .regex(/[^A-Za-z0-9\s]/, "Password must contain at least one symbol");

/**
 * Canonical requirement descriptors for the UI checklist.
 * Each entry mirrors exactly one rule in passwordSchema so schema and UI
 * can never drift: the consistency test in password.test.ts enforces this.
 */
export interface PasswordRequirement {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  {
    id: "min-length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (pw) => pw.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "uppercase",
    label: "One uppercase letter",
    test: (pw) => /[A-Z]/.test(pw),
  },
  {
    id: "lowercase",
    label: "One lowercase letter",
    test: (pw) => /[a-z]/.test(pw),
  },
  {
    id: "digit",
    label: "One number",
    test: (pw) => /[0-9]/.test(pw),
  },
  {
    id: "symbol",
    // Whitespace excluded — must match the schema regex above.
    label: "One symbol",
    test: (pw) => /[^A-Za-z0-9\s]/.test(pw),
  },
];
