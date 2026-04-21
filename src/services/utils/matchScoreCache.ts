type MatchScoreCacheValue = unknown;

type CacheEntry = {
  expiresAt: number;
  value: MatchScoreCacheValue;
};

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 1200;
const MAX_ENTRIES = 2000;

const parsePositiveInt = (raw: string | undefined, fallback: number) => {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const ttlMs = parsePositiveInt(process.env.MATCH_SCORE_CACHE_TTL_MS, DEFAULT_TTL_MS);

const keyFor = (tenantId: string, matchId: string) => `${tenantId}:${matchId}`;

const cleanupExpired = () => {
  const now = Date.now();
  cache.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  });
};

export const getCachedMatchScore = <T>(tenantId: string, matchId: string): T | null => {
  const key = keyFor(tenantId, matchId);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
};

export const setCachedMatchScore = <T>(tenantId: string, matchId: string, value: T) => {
  if (cache.size >= MAX_ENTRIES) {
    cleanupExpired();
    if (cache.size >= MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (oldestKey) {
        cache.delete(oldestKey);
      }
    }
  }

  cache.set(keyFor(tenantId, matchId), {
    value,
    expiresAt: Date.now() + ttlMs
  });
};

export const invalidateCachedMatchScore = (tenantId: string, matchId: string) => {
  cache.delete(keyFor(tenantId, matchId));
};

