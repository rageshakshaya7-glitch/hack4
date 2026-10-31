export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FATAL: JWT_SECRET environment variable is required in production.");
    }
    return new TextEncoder().encode("brightloop-dev-fallback-secret-minimum-32-chars-long");
  }
  return new TextEncoder().encode(secret);
}

export const APP_URL = process.env.APP_URL || "http://localhost:3000";

