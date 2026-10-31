import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { SessionUser, requireAuth, requireRole } from "./session";
import type { Role } from "./permissions";

export interface ApiErrorResponse {
  error: string;
  fields?: Record<string, string>;
}

export type ApiHandler = (
  req: NextRequest,
  ctx?: any
) => Promise<NextResponse | Response>;

export type AuthenticatedApiHandler = (
  req: NextRequest,
  session: SessionUser,
  ctx?: any
) => Promise<NextResponse | Response>;

export function jsonError(message: string, status: number = 400, fields?: Record<string, string>) {
  const body: ApiErrorResponse = { error: message };
  if (fields && Object.keys(fields).length > 0) {
    body.fields = fields;
  }
  return NextResponse.json(body, { status });
}

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const path = issue.path.join(".");
      if (!fields[path]) {
        fields[path] = issue.message;
      }
    }
    return jsonError("Validation failed", 400, fields);
  }

  const statusCode = (err as any)?.statusCode;
  const message = (err as any)?.message || "Internal server error";

  if (statusCode === 401 || message === "Unauthorized") {
    return jsonError("Authentication required", 401);
  }
  if (statusCode === 403 || message === "Forbidden") {
    return jsonError("Permission denied", 403);
  }
  if (statusCode === 404 || message === "Not found") {
    return jsonError("Resource not found", 404);
  }
  if (statusCode === 429) {
    return jsonError(message || "Too many requests", 429);
  }

  console.error("API Unhandled Error:", err);
  return jsonError("An unexpected error occurred", 500);
}

export function withAuth(handler: AuthenticatedApiHandler): ApiHandler {
  return async (req: NextRequest, ctx?: any) => {
    try {
      const session = await requireAuth();
      return await handler(req, session, ctx);
    } catch (err) {
      return handleApiError(err);
    }
  };
}

export function withRole(roles: Role[], handler: AuthenticatedApiHandler): ApiHandler {
  return async (req: NextRequest, ctx?: any) => {
    try {
      const session = await requireRole(...roles);
      return await handler(req, session, ctx);
    } catch (err) {
      return handleApiError(err);
    }
  };
}

