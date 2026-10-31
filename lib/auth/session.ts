import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { verifyToken, COOKIE_NAME } from "./jwt";
import type { Role } from "./permissions";

export interface SessionUser {
  userId: string;
  email: string;
  name: string;
  role: Role;
  customerProfileId?: string | null;
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const payload = await verifyToken(token);
    if (!payload) return null;

    // Verify user exists and is active in database
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { customer: { select: { id: true } } },
    });

    if (!user || !user.isActive) {
      return null;
    }

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      customerProfileId: user.customer?.id ?? null,
    };
  } catch (error) {
    return null;
  }
}

export async function requireAuth(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    const error = new Error("Unauthorized");
    (error as any).statusCode = 401;
    throw error;
  }
  return session;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const session = await requireAuth();
  if (!roles.includes(session.role)) {
    const error = new Error("Forbidden");
    (error as any).statusCode = 403;
    throw error;
  }
  return session;
}

export function setSessionCookie(response: Response | Headers, token: string): void {
  const isProduction = process.env.NODE_ENV === "production";
  const maxAge = 7 * 24 * 60 * 60; // 7 days in seconds
  const cookieValue = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
    isProduction ? "; Secure" : ""
  }`;

  if ("headers" in response && typeof (response as Response).headers?.append === "function") {
    (response as Response).headers.append("Set-Cookie", cookieValue);
  } else if ("append" in response && typeof (response as Headers).append === "function") {
    (response as Headers).append("Set-Cookie", cookieValue);
  }
}

export function clearSessionCookie(response: Response | Headers): void {
  const cookieValue = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  if ("headers" in response && typeof (response as Response).headers?.append === "function") {
    (response as Response).headers.append("Set-Cookie", cookieValue);
  } else if ("append" in response && typeof (response as Headers).append === "function") {
    (response as Headers).append("Set-Cookie", cookieValue);
  }
}

