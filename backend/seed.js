require("dotenv").config();
const fs = require("fs");
const path = require("path");
const redis = require("./lib/redis");

async function seed() {
  const file = process.argv[2] || path.join(__dirname, "sentinel-keys.txt");  // keep this file OUT of GitHub
  console.log(`[seed] Reading keys from ${file}`);

  if (!fs.existsSync(file)) {
    throw new Error(`Key file not found: ${file}`);
  }

  const lines = fs.readFileSync(file, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  console.log(`[seed] Found ${lines.length} keys in file`);
  if (!lines.length) {
    console.warn("[seed] No keys found in file, nothing to seed");
  }

  await redis.del("key_order");
  await redis.del("key_index");
  const existingIds = await redis.hkeys("keys");
  if (existingIds.length) {
    console.log(`[seed] Clearing ${existingIds.length} existing hash entries`);
    await redis.hdel("keys", ...existingIds);
  }

  const idsInOrder = [];
  for (let i = 0; i < lines.length; i++) {
    const id = `k${i + 1}`;
    const entry = { id, key: lines[i], copied: false, copiedAt: null };
    await redis.hset("keys", { [id]: JSON.stringify(entry) });
    await redis.hset("key_index", { [lines[i]]: id });
    idsInOrder.push(id);
  }

  if (idsInOrder.length) {
    await redis.rpush("key_order", ...idsInOrder);
  }

  const verifyOrder = await redis.lrange("key_order", 0, -1);
  console.log(`[seed] Seeded ${idsInOrder.length} keys. key_order now has ${verifyOrder.length} entries.`);
}

seed().then(() => process.exit(0)).catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
