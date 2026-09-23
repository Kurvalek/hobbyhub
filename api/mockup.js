import { applyCors } from "./_lib/cors.js";
import { mockupConfigured, renderMockup } from "./_lib/mockup.js";

// Largest reference image accepted, as a base64 data URL. The studio sends a
// 1024px PNG of the design, which is well under a megabyte; the cap is here so an
// arbitrary upload can't be pushed through to a paid image model.
const MAX_IMAGE_BYTES = Number(process.env.MAX_MOCKUP_IMAGE_BYTES) || 4194304; // 4 MB

const TYPES = new Set(["quilt", "cross-stitch", "punch-needle"]);

// POST /api/mockup  { type, presetName, image }  ->  { image }
// A photograph of what the design becomes, for the kit review page. Like
// /api/render and /api/bom the design travels in the request body and nothing is
// stored — the studio caches the result for the visit.
//
// Note there's no auth here, in keeping with the rest of the design endpoints,
// but unlike them this one costs money per call. What keeps it from being a free
// image generator for strangers is that the prompt is built server-side from the
// craft and size alone (see _lib/mockup.js); the worst a caller can do is spend a
// render on a picture of their own bitmap as a quilt.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  // GET is the availability probe. The review page asks first and leaves the
  // preview out altogether when the answer is no, rather than offering a button
  // that spends a click discovering there's no key. Cacheable because the answer
  // only changes on redeploy.
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({ configured: mockupConfigured() });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  if (!mockupConfigured()) {
    return res.status(501).json({ error: "mockups_not_configured" });
  }

  const { type, presetName, image } = req.body || {};

  if (!TYPES.has(type)) {
    return res.status(400).json({ error: "invalid_payload", message: `type must be one of: ${[...TYPES].join(", ")}` });
  }
  if (typeof image !== "string" || !image.startsWith("data:image/png;base64,")) {
    return res.status(400).json({ error: "invalid_payload", message: "image must be a base64 PNG data URL" });
  }
  if (Buffer.byteLength(image, "utf8") > MAX_IMAGE_BYTES) {
    return res.status(400).json({ error: "image_too_large" });
  }

  try {
    const mockup = await renderMockup({ type, presetName, image });
    // Generated fresh each time and not stored, so nothing downstream should
    // hold on to it either.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ image: mockup });
  } catch (e) {
    console.warn("Mockup render failed:", e.message);
    if (e.blocked) return res.status(422).json({ error: "blocked_by_moderation" });
    return res.status(502).json({ error: "mockup_failed" });
  }
}
