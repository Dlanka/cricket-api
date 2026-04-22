type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 1200;
const MAX_ENTRIES = 4000;

const parsePositiveInt = (raw: string | undefined, fallback: number) => {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const ttlMs = parsePositiveInt(process.env.SCORING_READ_CACHE_TTL_MS, DEFAULT_TTL_MS);

const cleanupExpired = () => {
  const now = Date.now();
  cache.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  });
};

const getCached = <T>(key: string): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
};

const setCached = <T>(key: string, value: T) => {
  if (cache.size >= MAX_ENTRIES) {
    cleanupExpired();
    if (cache.size >= MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (oldestKey) {
        cache.delete(oldestKey);
      }
    }
  }

  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
};

const removeByPrefix = (prefix: string) => {
  const keysToDelete: string[] = [];
  cache.forEach((_entry, key) => {
    if (key.startsWith(prefix)) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => cache.delete(key));
};

const inningsKey = (tenantId: string, inningsId: string, suffix: string) =>
  `innings:${tenantId}:${inningsId}:${suffix}`;
const matchKey = (tenantId: string, matchId: string, suffix: string) =>
  `match:${tenantId}:${matchId}:${suffix}`;

export const getCachedInningsRead = <T>(
  tenantId: string,
  inningsId: string,
  suffix: string
): T | null => getCached<T>(inningsKey(tenantId, inningsId, suffix));

export const setCachedInningsRead = <T>(
  tenantId: string,
  inningsId: string,
  suffix: string,
  value: T
) => {
  setCached(inningsKey(tenantId, inningsId, suffix), value);
};

export const invalidateInningsReadCache = (tenantId: string, inningsId: string) => {
  removeByPrefix(`innings:${tenantId}:${inningsId}:`);
};

export const getCachedMatchRead = <T>(
  tenantId: string,
  matchId: string,
  suffix: string
): T | null => getCached<T>(matchKey(tenantId, matchId, suffix));

export const setCachedMatchRead = <T>(
  tenantId: string,
  matchId: string,
  suffix: string,
  value: T
) => {
  setCached(matchKey(tenantId, matchId, suffix), value);
};

export const invalidateMatchReadCache = (tenantId: string, matchId: string) => {
  removeByPrefix(`match:${tenantId}:${matchId}:`);
};
