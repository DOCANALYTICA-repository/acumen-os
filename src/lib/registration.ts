import { z } from "zod";

/**
 * Team registration (one form for the whole team, modelled on Bidwave's wizard).
 * Shared by the browser (step-by-step checks) and the server action, which re-runs the same schema.
 */

export const YEARS = ["1st year", "2nd year", "3rd year", "4th year", "Postgraduate"] as const;
export const SOURCES = ["Instagram", "LinkedIn", "WhatsApp", "Friend", "College club", "Other"] as const;

export const RECEIPT_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;
/** Vercel rejects request bodies over ~4.5 MB, so receipts stay under 4 MB. */
export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;

const BLOCKED_WORDS = ["fuck", "shit", "bitch", "bastard", "asshole", "dick", "slut"];

export const teamNameSchema = z
  .string()
  .trim()
  .min(3, "Team name must be 3–30 characters")
  .max(30, "Team name must be 3–30 characters")
  .regex(/^[\p{L}\p{N} .'&_-]+$/u, "Use letters, numbers, spaces and . ' & _ - only")
  .refine((n) => !BLOCKED_WORDS.some((w) => n.toLowerCase().includes(w)), "Please choose a different team name");

export const memberSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the full name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z
    .string()
    .trim()
    .min(8, "Enter a valid phone number")
    .max(20)
    .regex(/^[0-9+\-\s()]+$/, "Enter a valid phone number"),
  college: z.string().trim().min(2, "Enter the college").max(120),
  year: z.enum(YEARS, { message: "Select the year" }),
});

export type MemberInput = z.infer<typeof memberSchema>;

export const registrationSchema = z
  .object({
    teamName: teamNameSchema,
    members: z
      .array(memberSchema)
      .length(2, "Teams are exactly two people")
      .refine((m) => m[0]?.email !== m[1]?.email, { message: "Each member needs a different email" }),
    password: z.string().min(8, "At least 8 characters").max(72),
    passwordConfirm: z.string(),
    city: z.string().trim().max(60).optional().default(""),
    source: z.string().trim().max(60).optional().default(""),
    transactionId: z.string().trim().max(64).optional().default(""),
    consent: z.literal(true, { message: "Please accept to continue" }),
  })
  .refine((d) => d.password === d.passwordConfirm, { message: "Passwords do not match", path: ["passwordConfirm"] });

export type RegistrationInput = z.input<typeof registrationSchema>;

/** Checks a receipt File in the browser or on the server. Returns an error message or null. */
export function receiptError(file: File | null | undefined): string | null {
  if (!file || file.size === 0) return "Attach your payment receipt.";
  if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) return "Attach a JPG, PNG, WEBP or PDF.";
  if (file.size > RECEIPT_MAX_BYTES) return "The receipt must be 4 MB or smaller.";
  return null;
}
