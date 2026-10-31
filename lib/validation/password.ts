import { z } from "zod";

export const passwordChecks = {
  minLength: (p: string) => p.length >= 9,
  hasUpper: (p: string) => /[A-Z]/.test(p),
  hasLower: (p: string) => /[a-z]/.test(p),
  hasSpecial: (p: string) => /[^A-Za-z0-9]/.test(p),
};

export const passwordSchema = z
  .string()
  .min(9, "Password must be at least 9 characters long (more than 8)")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

export const emailSchema = z
  .string()
  .email("Invalid email address")
  .transform((val) => val.trim().toLowerCase());

