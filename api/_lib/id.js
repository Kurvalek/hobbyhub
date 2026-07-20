import { randomBytes } from "node:crypto";

// 16 random bytes -> 22-char URL-safe string, ~128 bits of entropy.
// Opaque and unguessable by design: this ID is the only access control
// on a design record (see api/designs/[id].js).
export function generateDesignId() {
  return randomBytes(16).toString("base64url");
}

export const DESIGN_ID_PATTERN = /^[A-Za-z0-9_-]{20,24}$/;
