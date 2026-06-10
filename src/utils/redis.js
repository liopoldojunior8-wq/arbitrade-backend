// src/utils/redis.js
const Redis = require("ioredis");
let client;

async function connectRedis() {
  client = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  await client.connect().catch(() => {}); // non-fatal if Redis unavailable
  return client;
}

async function getCache(key) {
  try {
    const val = await client?.get(key);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}

async function setCache(key, value, ttlSeconds = 300) {
  try {
    await client?.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {}
}

async function delCache(key) {
  try { await client?.del(key); } catch {}
}

module.exports = { connectRedis, getCache, setCache, delCache };
