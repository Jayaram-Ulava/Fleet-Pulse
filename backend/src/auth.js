import { randomBytes } from 'node:crypto';

const ACCESS_TOKEN_LIFETIME_MS = 5 * 60 * 1000;
const REFRESH_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const accounts = [
  {
    id: 'operator-1',
    email: 'operator@pulse.dev',
    password: 'pulse123',
    role: 'operator',
  },
  {
    id: 'viewer-1',
    email: 'viewer@pulse.dev',
    password: 'pulse123',
    role: 'viewer',
  },
];

function publicUser(account) {
  return { id: account.id, email: account.email, role: account.role };
}

function createToken() {
  return randomBytes(32).toString('base64url');
}

export function createAuthService(now = Date.now) {
  const accessTokens = new Map();
  const refreshTokens = new Map();

  function issueSession(account) {
    const accessToken = createToken();
    const refreshToken = createToken();
    const issuedAt = now();

    accessTokens.set(accessToken, {
      user: publicUser(account),
      expiresAt: issuedAt + ACCESS_TOKEN_LIFETIME_MS,
    });
    refreshTokens.set(refreshToken, {
      user: publicUser(account),
      expiresAt: issuedAt + REFRESH_TOKEN_LIFETIME_MS,
    });

    return { accessToken, refreshToken, user: publicUser(account) };
  }

  return {
    login(email, password) {
      const account = accounts.find(
        (candidate) => candidate.email === email && candidate.password === password,
      );

      return account ? issueSession(account) : null;
    },

    refresh(refreshToken) {
      const session = refreshTokens.get(refreshToken);
      refreshTokens.delete(refreshToken);

      if (!session || session.expiresAt <= now()) {
        return null;
      }

      const account = accounts.find((candidate) => candidate.id === session.user.id);
      return account ? issueSession(account) : null;
    },

    authenticate(accessToken) {
      const session = accessTokens.get(accessToken);

      if (!session || session.expiresAt <= now()) {
        accessTokens.delete(accessToken);
        return null;
      }

      return session.user;
    },

    revoke(refreshToken) {
      const session = refreshTokens.get(refreshToken);
      if (!session) {
        return;
      }

      for (const [token, activeSession] of accessTokens) {
        if (activeSession.user.id === session.user.id) {
          accessTokens.delete(token);
        }
      }

      for (const [token, activeSession] of refreshTokens) {
        if (activeSession.user.id === session.user.id) {
          refreshTokens.delete(token);
        }
      }
    },
  };
}
