import type { FastifyRequest } from "fastify";

import { AuthError, getSession } from "./auth-service.js";

const SESSION_COOKIE = "riventa_session";

function readSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");

    if (separator < 0) continue;

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (name === SESSION_COOKIE) {
      return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
    }
  }

  return null;
}

export async function requireSession(request: FastifyRequest) {
  const token = readSessionToken(request.headers.cookie);

  if (!token) {
    throw new AuthError("UNAUTHENTICATED", 401);
  }

  const session = await getSession(token);

  if (!session) {
    throw new AuthError("UNAUTHENTICATED", 401);
  }

  return session;
}
