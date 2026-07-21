import { Redis } from "@upstash/redis";

// Single shared Upstash client for all serverless functions. Created lazily so
// importing this module never requires the env vars to be present at build time.
let client = null;
export function redis() {
  if (!client) client = Redis.fromEnv();
  return client;
}
