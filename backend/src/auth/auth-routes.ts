import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest
} from "fastify";

import { config } from "../config.js";
import {
  AuthError,
  createLoginChallenge,
  getSession,
  logoutSession,
  verifyLoginChallenge
} from "./auth-service.js";

const SESSION_COOKIE = "riventa_session";

interface ChallengeBody {
  accountId: string;
}

interface VerifyBody {
  challengeId: string;
  accountId: string;
  publicKey: string;
  signature: string;
  state: string;
}

function readSessionToken(
  cookieHeader: string | undefined
): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");

    if (separator < 0) continue;

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (name === SESSION_COOKIE) {
      return /^[A-Za-z0-9_-]{43}$/.test(value)
        ? value
        : null;
    }
  }

  return null;
}

function assertAllowedOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;

  if (
    typeof origin !== "string" ||
    !config.corsOrigins.includes(origin)
  ) {
    throw new AuthError("ORIGIN_NOT_ALLOWED", 403);
  }
}

function sessionCookie(token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${config.auth.sessionTtlSeconds}`
  ];

  if (config.auth.cookieSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function clearedSessionCookie(): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
  ];

  if (config.auth.cookieSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function handleRouteError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown
) {
  if (error instanceof AuthError) {
    return reply.code(error.statusCode).send({
      error: error.message
    });
  }

  request.log.error({ err: error }, "Authentication route failed");

  return reply.code(500).send({
    error: "INTERNAL_SERVER_ERROR"
  });
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: ChallengeBody }>(
    "/auth/challenge",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["accountId"],
          properties: {
            accountId: {
              type: "string",
              minLength: 2,
              maxLength: 64
            }
          }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");

      try {
        assertAllowedOrigin(request);

        const challenge = await createLoginChallenge(
          request.body.accountId
        );

        return reply.send(challenge);
      } catch (error) {
        return handleRouteError(request, reply, error);
      }
    }
  );

  app.post<{ Body: VerifyBody }>(
    "/auth/verify",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "challengeId",
            "accountId",
            "publicKey",
            "signature",
            "state"
          ],
          properties: {
            challengeId: {
              type: "string",
              format: "uuid"
            },
            accountId: {
              type: "string",
              minLength: 2,
              maxLength: 64
            },
            publicKey: {
              type: "string",
              minLength: 40,
              maxLength: 100
            },
            signature: {
              type: "string",
              minLength: 80,
              maxLength: 100
            },
            state: {
              type: "string",
              minLength: 1,
              maxLength: 128
            }
          }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");

      try {
        assertAllowedOrigin(request);

        const result = await verifyLoginChallenge(request.body);

        reply.header(
          "set-cookie",
          sessionCookie(result.sessionToken)
        );

        return reply.send({
          authenticated: true,
          session: result.session
        });
      } catch (error) {
        return handleRouteError(request, reply, error);
      }
    }
  );

  app.get("/auth/me", async (request, reply) => {
    reply.header("cache-control", "no-store");

    try {
      const token = readSessionToken(request.headers.cookie);

      if (!token) {
        return reply.code(401).send({
          error: "UNAUTHENTICATED"
        });
      }

      const session = await getSession(token);

      if (!session) {
        return reply.code(401).send({
          error: "UNAUTHENTICATED"
        });
      }

      return reply.send({
        authenticated: true,
        session
      });
    } catch (error) {
      return handleRouteError(request, reply, error);
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    reply.header("cache-control", "no-store");

    try {
      assertAllowedOrigin(request);

      const token = readSessionToken(request.headers.cookie);

      if (token) {
        await logoutSession(token);
      }

      reply.header("set-cookie", clearedSessionCookie());

      return reply.send({
        authenticated: false
      });
    } catch (error) {
      return handleRouteError(request, reply, error);
    }
  });
};
