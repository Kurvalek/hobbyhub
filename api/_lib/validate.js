const MAX_DESIGN_BYTES = Number(process.env.MAX_DESIGN_BYTES) || 262144; // 256 KB

const REQUIRED_FIELDS = {
  quilt: ["cols", "rows", "shapes"],
  "cross-stitch": ["w", "h", "grid"],
  "punch-needle": ["w", "h", "grid"],
};

// Scaffold-level sanity check, not exhaustive schema enforcement: fails fast
// on obviously malformed input so the store never accumulates junk records.
// Returns an error string, or null if the payload is valid.
export function validateDesignPayload(body) {
  if (!body || typeof body !== "object") {
    return "body must be a JSON object";
  }

  const { type, data } = body;
  const requiredFields = REQUIRED_FIELDS[type];
  if (!requiredFields) {
    return `type must be one of: ${Object.keys(REQUIRED_FIELDS).join(", ")}`;
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "data must be an object";
  }

  for (const field of requiredFields) {
    if (!(field in data)) {
      return `data.${field} is required for type "${type}"`;
    }
  }

  const dataSize = Buffer.byteLength(JSON.stringify(data), "utf8");
  if (dataSize > MAX_DESIGN_BYTES) {
    return "payload_too_large";
  }

  return null;
}
