import { SignJWT, jwtVerify } from "jose";
import { getJwtSecret } from "@/lib/env";

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  name: string;
}

const COOKIE_NAME = "brightloop_session";

export async function signToken(payload: TokenPayload): Promise<string> {
  const secret = getJwtSecret();
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const secret = getJwtSecret();
    const { payload } = await jwtVerify(token, secret);
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as string,
      name: payload.name as string,
    };
  } catch (err) {
    return null;
  }
}

export { COOKIE_NAME };

