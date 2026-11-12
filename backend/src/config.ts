function readInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }

  return value;
}

function readOptionalPositiveInteger(name: string): number | null {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === "") return null;

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }

  return value;
}

function readOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;

  return (raw ?? "http://127.0.0.1:3000,http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: readInteger("PORT", 4000),
  corsOrigins: readOrigins(),

  near: {
    contractId: process.env.NEAR_CONTRACT_ID ?? null,
    indexerStartBlock: readOptionalPositiveInteger("NEAR_INDEXER_START_BLOCK"),
  },

  auth: {
    network: process.env.NEAR_NETWORK ?? "testnet",
    rpcUrl: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org",
    recipient: process.env.AUTH_RECIPIENT ?? "http://127.0.0.1:3000",
    challengeTtlSeconds: readInteger("AUTH_CHALLENGE_TTL_SECONDS", 300),
    sessionTtlSeconds: readInteger("AUTH_SESSION_TTL_SECONDS", 604800),
    cookieSecure: process.env.NODE_ENV === "production",
  },

  database: {
    host: process.env.PGHOST ?? "/var/run/postgresql",
    port: readInteger("PGPORT", 5432),
    user: process.env.PGUSER ?? "emperor",
    database: process.env.PGDATABASE ?? "riventa_dev",
    password: process.env.PGPASSWORD,
    max: readInteger("PGPOOL_MAX", 10),
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
  },
} as const;
