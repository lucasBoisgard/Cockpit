const CACHE_TTL_MS = 2500;

let cache = null;

function cachedSnapshot() {
  return cache && Date.now() - cache.at < CACHE_TTL_MS ? cache.data : null;
}

function storeSnapshot(data) {
  cache = { at: Date.now(), data };
}

function invalidateSnapshot() {
  cache = null;
}

module.exports = { cachedSnapshot, storeSnapshot, invalidateSnapshot };
