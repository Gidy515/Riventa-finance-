import { database, withTransaction } from "../db/pool.js";

export interface AuthChallengeRecord {
  id: string;
  network: string;
  accountId: string;
  message: string;
  nonce: Buffer;
  recipient: string;
  state: string;
  expiresAt: Date;
}

export interface AuthSessionRecord {
  network: string;
  accountId: string;
  publicKey: string;
  expiresAt: Date;
}

export async function insertChallenge(
  challenge: AuthChallengeRecord
): Promise<void> {
  await database.query(
    `INSERT INTO auth_challenges (
       id,
       network,
       account_id,
       message,
       nonce,
       recipient,
       state,
       expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      challenge.id,
      challenge.network,
      challenge.accountId,
      challenge.message,
      challenge.nonce,
      challenge.recipient,
      challenge.state,
      challenge.expiresAt
    ]
  );
}

export async function findChallenge(
  id: string,
  network: string,
  accountId: string
): Promise<AuthChallengeRecord | null> {
  const result = await database.query<{
    id: string;
    network: string;
    account_id: string;
    message: string;
    nonce: Buffer;
    recipient: string;
    state: string;
    expires_at: Date;
  }>(
    `SELECT
       id,
       network,
       account_id,
       message,
       nonce,
       recipient,
       state,
       expires_at
     FROM auth_challenges
     WHERE id = $1
       AND network = $2
       AND account_id = $3
       AND consumed_at IS NULL
       AND expires_at > NOW()`,
    [id, network, accountId]
  );

  const row = result.rows[0];

  if (!row) return null;

  return {
    id: row.id,
    network: row.network,
    accountId: row.account_id,
    message: row.message,
    nonce: row.nonce,
    recipient: row.recipient,
    state: row.state,
    expiresAt: row.expires_at
  };
}

export async function consumeChallengeAndCreateSession(input: {
  challengeId: string;
  network: string;
  accountId: string;
  publicKey: string;
  tokenHash: Buffer;
  expiresAt: Date;
}): Promise<void> {
  await withTransaction(async (client) => {
    const consumed = await client.query(
      `UPDATE auth_challenges
       SET consumed_at = NOW()
       WHERE id = $1
         AND network = $2
         AND account_id = $3
         AND consumed_at IS NULL
         AND expires_at > NOW()
       RETURNING id`,
      [
        input.challengeId,
        input.network,
        input.accountId
      ]
    );

    if (consumed.rowCount !== 1) {
      throw new Error("CHALLENGE_ALREADY_USED_OR_EXPIRED");
    }

    await client.query(
      `INSERT INTO auth_sessions (
         token_hash,
         network,
         account_id,
         public_key,
         expires_at
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.tokenHash,
        input.network,
        input.accountId,
        input.publicKey,
        input.expiresAt
      ]
    );
  });
}

export async function findSession(
  tokenHash: Buffer
): Promise<AuthSessionRecord | null> {
  const result = await database.query<{
    network: string;
    account_id: string;
    public_key: string;
    expires_at: Date;
  }>(
    `SELECT network, account_id, public_key, expires_at
     FROM auth_sessions
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()`,
    [tokenHash]
  );

  const row = result.rows[0];

  if (!row) return null;

  return {
    network: row.network,
    accountId: row.account_id,
    publicKey: row.public_key,
    expiresAt: row.expires_at
  };
}

export async function revokeSession(
  tokenHash: Buffer
): Promise<void> {
  await database.query(
    `UPDATE auth_sessions
     SET revoked_at = NOW()
     WHERE token_hash = $1
       AND revoked_at IS NULL`,
    [tokenHash]
  );
}
