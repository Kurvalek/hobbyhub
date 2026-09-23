// Turns a design into a photograph of the thing it becomes, for the kit review
// page. The studio sends a flat PNG of the layout; an image model is asked to
// reproduce that exact layout in the craft's real materials.
//
// The prompt is assembled here and never accepted from the caller. An endpoint
// that forwards a client-supplied prompt to a paid image model is an open tab at
// someone else's expense, and this one needs no auth by design.

const API_URL = "https://api.openai.com/v1/images/edits";

// gpt-image-2 is the current GPT Image model; earlier ones are on their way out.
// Overridable because image models turn over faster than this code will.
const MODEL = process.env.MOCKUP_MODEL || "gpt-image-2";
// "medium" is the deliberate default: this is a reassurance on a product page,
// not the product. "high" roughly triples the cost per image for detail nobody
// is going to pixel-peep at 400px wide.
const QUALITY = process.env.MOCKUP_QUALITY || "medium";
const SIZE = process.env.MOCKUP_SIZE || "1024x1024";

// How each craft actually looks close up. The model's default idea of "cross
// stitch" is a printed picture of a chart, so the texture has to be spelled out:
// the weave, what the stitches sit on, how light catches the thread.
const CRAFT_LOOK = {
  "quilt":
    "a finished patchwork quilt sewn from quilting cotton. Every patch is a separate " +
    "piece of fabric joined with visible seams, the surface is lightly quilted, and the " +
    "weave of the cotton and the loft of the batting are visible",
  "cross-stitch":
    "a finished cross-stitch piece worked in stranded cotton floss on 14-count Aida " +
    "cloth. Every coloured square in the reference is one X-shaped stitch over one " +
    "block of the woven Aida, with the individual strands and the holes of the weave " +
    "visible, and the unstitched cloth showing as plain fabric",
  "punch-needle":
    "a finished punch-needle piece worked in tapestry wool on monk's cloth. Every " +
    "coloured square in the reference is a loop of wool standing up from the surface, " +
    "giving a dense velvety pile with visible individual loops and a soft raised edge " +
    "where colours meet",
};

// The object the kit becomes, per finished-size preset. Keys match SHOPIFY_KITS in
// index.html, because that name is the only thing tying a design to its kit.
//
// Every one of these shows the whole piece, flat and unobstructed. Folds and drapes
// photograph beautifully and are wrong here: this picture is how someone checks
// their own layout before paying, and a fold hides patches and changes the apparent
// number of rows. Styling comes second to being able to see what you designed.
const PRESET_OBJECT = {
  "quilt": {
    "Coaster": "a set of four small quilted coasters, laid out flat side by side on a table, all four fully visible",
    "Wall hanging": "a small quilted wall hanging, hung flat and square against a plain pale wall, the whole piece visible",
    "Baby blanket": "a baby quilt, laid out completely flat and square on a pale wooden floor, the entire quilt top visible edge to edge with no folds",
    "Throw": "a throw quilt, laid out completely flat and square on a pale wooden floor, the entire quilt top visible edge to edge with no folds or draping",
  },
  "cross-stitch": {
    "Coaster Set": "a set of four stitched coasters, backed and trimmed, stacked on a table",
    "Bookmark": "a finished stitched bookmark, backed with felt, resting on a closed book",
    "Small Hoop": "mounted in a small round wooden embroidery hoop, hung on a plain pale wall",
    "Medium Hoop": "mounted in a round wooden embroidery hoop, hung on a plain pale wall",
  },
  "punch-needle": {
    "Coaster": "a set of four punched coasters, backed with felt, stacked on a table",
    "Wall Hanging": "mounted in a round wooden hoop, hung on a plain pale wall",
    "Pillow": "made up into a square cushion with a fabric back, resting on a chair",
  },
};

// Fallback when a design carries a size we don't have wording for — a "Custom"
// board, or a preset added to the studio before this table caught up.
const GENERIC_OBJECT = "the finished piece, photographed flat on a pale wooden table";

// True once the image service is wired up. Kept separate so the endpoint can say
// "not configured" rather than failing like an outage.
export function mockupConfigured() {
  return !!process.env.OPENAI_API_KEY;
}

export function mockupPrompt(type, presetName) {
  const look = CRAFT_LOOK[type];
  if (!look) return null;
  const object = (PRESET_OBJECT[type] || {})[presetName] || GENERIC_OBJECT;
  // Order matters: the fidelity instruction comes first and last, because the
  // failure mode that ruins this feature is a beautiful picture of a different
  // design. Everything else is scene-setting.
  return [
    `Reproduce the design in the reference image exactly as ${look}.`,
    `Show it as ${object}.`,
    "Keep the layout, proportions and colours of the reference image precisely: same " +
      "number of rows and columns, same shape in the same place, same colour in the same " +
      "place. Do not redraw, restyle, simplify, embellish or re-centre the design, and do " +
      "not add motifs, borders, lettering or extra colours that are not in the reference.",
    // Straight-on and wholly in focus, for the same reason the presets above are
    // flat: a blurred or angled edge is a patch the buyer can't check.
    "Photograph it straight on in soft, natural daylight against a plain uncluttered " +
      "background, with the whole piece sharp and in focus from edge to edge. No people, " +
      "no hands, no packaging, no text or watermarks.",
    "The reference image is a flat colour map of the design, not a photograph — treat it " +
      "as the pattern to be worked, and let the material's own texture supply the surface.",
  ].join(" ");
}

// Renders the design as the finished object and resolves to a data URL.
//
// `image` is a PNG data URL of the design from the studio. The Images API accepts
// a data URL directly as a reference, so there's no upload step and nothing is
// stored on either end.
export async function renderMockup({ type, presetName, image }) {
  const prompt = mockupPrompt(type, presetName);
  if (!prompt) throw new Error(`no mockup prompt for type "${type}"`);

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      images: [{ image_url: image }],
      prompt,
      size: SIZE,
      quality: QUALITY,
      // WebP at 82 lands a 1024px photo around 60-90KB, which matters because
      // this travels back as a data URL and gets parked in sessionStorage.
      output_format: "webp",
      output_compression: 82,
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body && body.error ? body.error.message : `HTTP ${res.status}`;
    const err = new Error(detail);
    // A refusal is the caller's problem to explain, not a fault to retry.
    err.blocked = !!(body && body.error && body.error.code === "moderation_blocked");
    throw err;
  }

  const b64 = body && body.data && body.data[0] && body.data[0].b64_json;
  if (!b64) throw new Error("image response had no image");
  return `data:image/webp;base64,${b64}`;
}
