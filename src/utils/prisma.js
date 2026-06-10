// src/utils/prisma.js
const { PrismaClient } = require("@prisma/client");
const prisma = global.__prisma || new PrismaClient({ log: ["error", "warn"] });
if (process.env.NODE_ENV !== "production") global.__prisma = prisma;
module.exports = { prisma };

// ─────────────────────────────────────────────────────────
// src/utils/redis.js
// ─────────────────────────────────────────────────────────
