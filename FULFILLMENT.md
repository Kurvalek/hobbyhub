# Order fulfillment

What happens after someone buys a kit: the order arrives from Shopify, lands in
`admin.html`, and prints as the paper needed to pack the box.

Most of this existed before and had never carried a real order. The work below
closed the gaps, and found one bug that would have silently rejected every
order Shopify ever sent.

**Working now:** orders land, all nine documents render, the dashboard is
password-protected, and the whole chain can be exercised locally with no
Shopify account and no tunnel.

**Still to do:** run `supabase/migrations/0002_order_statuses.sql` in the
Supabase SQL editor (see [Order states](#order-states)), then set
`SHOPIFY_WEBHOOK_SECRET` in Vercel and register the `orders/create` webhook.
See [Going live](#going-live).

---

## How an order becomes paper

1. Someone designs a quilt, cross-stitch or punch needle piece and buys the
   matching kit. The design's id rides along as the line-item property
   `_design_id`.
2. Shopify posts `orders/create` to `/api/webhooks/order`, signed with an HMAC
   in the `X-Shopify-Hmac-Sha256` header.
3. The webhook verifies that signature against the raw bytes, resolves each
   line item to its design, computes a bill of materials, and writes `orders`
   and `order_items` rows.
4. `admin.html` lists the queue. Each order prints as a pick sheet, a packing
   slip, per-item charts and instructions, or all of it as one PDF.

The bill of materials is **frozen onto `order_items` at purchase** rather than
recomputed from the live design. Someone editing their design after buying it
cannot change what ships, and a reprint two weeks later matches what was pulled.

## Order states

Six steps, in order:

`new` → `supplies_pulled` → `printed` → `ready_to_pack` → `packed` → `shipped`

Plus `on_hold`, which sits outside that sequence. An order can be held from any
step — waiting on a restock, or on a reply about an address — and returns to
`new` when released.

These live in `ORDER_PIPELINE` / `ORDER_STATUSES` in `api/_lib/orders.js` and in
a check constraint on `orders.status`. **Both have to agree.** If the dashboard
reports *"The database doesn't know that status yet"*, run
`supabase/migrations/0002_order_statuses.sql` in the Supabase SQL editor — that
migration widens the constraint from the original four states to these seven,
and it's safe to run more than once.

## The dashboard

`admin.html` is a standalone page: no build step, no framework, no imports. It
has two views.

**Orders** is a table with a status tab per state and a live count on each, a
search over order number and customer, and an advance button on every row that
moves the order one step along. Clicking a row opens a detail panel: the
shipping address, a six-step progress bar that doubles as the status control,
and the order's supplies grouped by where they live in the studio — fabric,
embroidery floss, wool thread, batting and backing, needles, kit extras, charts
and instructions. Every supply has a checkbox, and the panel counts them off
("4 of 22 packed"). Those ticks are stored in `orders.checklist`, keyed
`<lineItemId>|<supplyKey>`, so they survive a reload and a webhook redelivery.

Ticking the checkbox on one or more rows raises an action bar along the bottom.
Its primary button advances every selected order one step from wherever each
one already is — a mixed selection moves each order from its own position, and
when they all share a step the button names the step they're going to.
**Move to…** sets an explicit state instead, including `on_hold`, and **Delete**
asks once before removing our copy of the orders.

Deleting only clears this database. Shopify still holds the order, so a webhook
redelivery recreates it — as a `new` order with an empty checklist, because the
statuses and the ticks live here and nowhere else. That's what the confirmation
is warning about.

The selection is pruned to the rows the current tab and search actually show,
so selecting a few orders, switching tab and pressing Delete can't reach
something that's no longer on screen.

**Materials** merges the supplies across whichever states you tick into a single
pull list, with a per-row count of how many orders want each thing. It defaults
to `new` and `supplies_pulled` — the orders that still need pulling.

Two things worth knowing about how it's built. `supplyRows()` mirrors
`bomSupplyRows()` in `api/_lib/render/packing.js`; the page cannot import it, so
if you change how a BOM flattens, change both or the screen and the pick sheet
will disagree. And patches are queued per order and only the last reply in is
allowed to overwrite local state — without that, ticking a pick list faster than
the round trip silently drops ticks.

## The documents

Nine renderings in total: two documents for each of the three crafts, plus
three that describe the whole order.

| Document | Scope | What it's for |
| --- | --- | --- |
| `chart` | design | The sheet you work from. A grid for cross-stitch and punch needle; for a quilt it renders as the cutting and assembly template instead. |
| `instructions` | design | Step-by-step, written separately per craft. |
| `pick-sheet` | order | Internal. A checkbox per supply, ending in the address. |
| `packing-slip` | order | Customer-facing. What's in the box, what they supply. |
| `bundle` | order | Everything above, one PDF, in packing order. |

The bundle is the one that needed real work. A cross-stitch chart is landscape
and everything else is portrait, and a single CSS `@page` rule can only
describe one orientation. It uses named page rules (`@page sheet0 { … }` plus a
`page:` property per sheet) so both survive into one file — the three-item test
order comes out eleven pages, ten portrait and one landscape.

Punch needle previously could not be printed at all. `chart.js` only understood
cross-stitch, so a punched kit reached the shelf with no chart and no
instructions. Gauge, skein arithmetic and legend labels are now configuration
rather than constants, and punch needle has its own eight instructions, which
are genuinely different work — frame tension, tracing mirrored on the back,
loop depth, glue to finish.

Both order documents scale by line quantity. A `2×` line was showing per-kit
amounts, which would have shorted the second kit.

Order documents are only reachable through the admin credential. The public
`/api/render` is narrowed to design documents, because the order ones carry a
shipping address and an internal pick list.

## Where the dashboard lives

The dashboard is served at `https://admin.makemetime.com`. It is the same Vercel
project and the same deployment as the storefront — one more domain pointed at
it, not a second app — so `/api/*` resolves without CORS and there is only ever
one thing to deploy.

Making a subdomain's root serve `admin.html` is the one fiddly part, because
Vercel checks the filesystem *before* applying `rewrites`, and `/` already
resolves to `index.html`. A rewrite from `/` would silently never fire. What
runs *ahead* of the filesystem is `routes`, so that is what `vercel.json` uses:

```json
"routes": [
  { "src": "/", "has": [{ "type": "host", "value": "admin.makemetime.com" }], "dest": "/admin.html" }
]
```

The `has` condition scopes it to that one hostname, so every other domain falls
through untouched and keeps serving the storefront. Two consequences worth
knowing. `has` **is ignored by `vercel dev`**, so locally the dashboard stays at
`http://localhost:3000/admin.html` and nothing about local work changes. And
`admin.html` is still reachable at `www.makemetime.com/admin.html`; that is left
deliberately, as a way in if the subdomain's DNS ever breaks. It is the same
password either way.

The session token lives in `localStorage`, which is per-origin, so moving to the
new hostname means signing in once more. The old session on `www` is untouched.

DNS for `makemetime.com` is at Namecheap, not Vercel — the nameservers are
`dns1/dns2.registrar-servers.com`. Subdomains are therefore added as CNAME
records there, pointing at the same target `www` and `studio` already use.

## Signing in to the dashboard

The dashboard takes a password. Set it in `ADMIN_PASSWORD`, in `.env` for local
work and in Vercel for production:

```
ADMIN_PASSWORD=whatever you choose
```

There is one admin, so the password is stored as-is rather than hashed. The
tradeoff is deliberate and worth stating plainly: anyone who can read the
environment — a Vercel env dump, a leaked `.env` — reads the password itself,
so it must not be one used anywhere else.

`/api/admin/login` compares the submitted password against `ADMIN_PASSWORD`
with `crypto.timingSafeEqual`. Both sides are hashed to 32-byte digests first,
purely so the comparison is length-blind: `timingSafeEqual` throws on a length
mismatch, and comparing the raw strings would leak the password's length
through that throw.

A correct password is traded for a signed session token, and the browser keeps
only that. Sessions last 30 days. The signing key is derived from
`ADMIN_PASSWORD`, so **changing the password immediately invalidates every
existing session** — that's the revocation mechanism.

Guessing is throttled to eight attempts per IP per fifteen minutes, which is
what keeps a plain password safe to leave facing the internet. The throttle is
held in memory per serverless instance, so a distributed attacker gets somewhat
more than eight tries; it removes the cheap high-volume case without taking on
a database.

`ADMIN_TOKEN` still works as a bearer credential. It exists so `curl` and the
scripts in `tools/` can reach the endpoints — they have no session to carry.
Keep it out of production; the password covers the real dashboard, and a second
permanent secret in production is one more thing to leak.

Both are read **once at process startup**: restart `npm start` after editing
`.env`, and redeploy after editing Vercel.

## Testing without Shopify

```bash
npm start                    # terminal 1
node tools/seed-order.mjs    # terminal 2
```

`seed-order.mjs` builds sample designs for all three crafts, posts them to
`/api/designs`, then signs a fake `orders/create` payload exactly as Shopify
would and posts it to the local webhook. No tunnel, no real purchase, no
Shopify account. It prints the order number and you can open `admin.html` and
fulfill it.

Useful flags: `--type quilt` to seed one craft, `--design <uuid>` to use an
existing design instead of a generated one, `--base` and `--secret` to point at
another server.

Two checks cover the document code, which is the part most likely to regress
quietly:

```bash
node tools/_check-render-docs.mjs
```

It renders all nine document types with no Supabase and no HTTP, and asserts
the bundle still contains both page orientations.

## Going live

Products are already live in Shopify and the webhook code is verified working.
What remains:

1. Run `supabase/migrations/0002_order_statuses.sql` in the Supabase SQL editor.
   Until you do, the last three status buttons return a 409 and the dashboard
   tells you so.
2. In Vercel, set `SHOPIFY_WEBHOOK_SECRET` to the signing secret Shopify shows
   when you create the webhook. **Not** the local placeholder — a mismatch
   rejects every order with a 401.
3. Register the webhook: Shopify **Settings → Notifications → Webhooks**, topic
   `orders/create`, format JSON, URL
   `https://YOUR-DOMAIN/api/webhooks/order`.
4. Redeploy. Vercel only applies environment changes to new deployments.
5. Place a real test order and confirm it appears in `admin.html`.

If a real order doesn't show up, suspect a secret mismatch between Shopify and
Vercel before suspecting the code.

## Environment variables

| Variable | Needed for |
| --- | --- |
| `SUPABASE_URL` | everything |
| `SUPABASE_PUBLISHABLE_KEY` | everything |
| `SUPABASE_SECRET_KEY` | webhook and admin writes (bypasses RLS) |
| `ADMIN_PASSWORD` | dashboard sign-in |
| `SHOPIFY_WEBHOOK_SECRET` | accepting real orders |
| `ADMIN_TOKEN` | local scripts and `curl` only |
| `CHROME_EXECUTABLE_PATH` | PDF rendering, local only |

`STITCHES_PER_SKEIN`, `LOOPS_PER_SKEIN`, `AIDA_MARGIN_IN` and
`MONKS_CLOTH_MARGIN_IN` tune the bill of materials and have sensible defaults.

Every one of these is read **once at process startup**. After editing `.env`,
restart `npm start`; after editing Vercel, redeploy. A surprising share of the
time lost to this system was spent on a correct value that the running process
had never read.

## When something breaks

The dashboard now names the cause rather than printing a status code. If you're
reading raw responses:

| Response | Means |
| --- | --- |
| `supabase_not_configured` | one of the three Supabase variables is empty |
| `admin_not_configured` | no `ADMIN_PASSWORD` and no `ADMIN_TOKEN` |
| `password_not_configured` | `ADMIN_PASSWORD` is unset |
| `invalid_password` | the password is wrong |
| `too_many_attempts` | throttled; wait, or restart the dev server to clear it |
| `status_not_migrated` | `0002_order_statuses.sql` hasn't been run on this database |

---

## Two bugs worth remembering

**Every real order would have been rejected.** `readRawBody` collected the body
with `for await (const chunk of req)`. Vercel's Node runtime always drains the
request stream to populate `req.body` — the `config.api.bodyParser` flag is a
Next.js convention this runtime ignores — and then pushes the consumed bytes
back through a `PassThrough` patched onto `req.on('data')`. Async iteration goes
through the stream's own internals rather than that patched `on`, so it saw a
stream that had already ended and yielded nothing. An empty body hashes
perfectly well, so there was no error to see: the signature simply never
matched, and every order would have come back 401 looking like a configuration
problem. It now reads by event listener, verified byte-identical on a signed
round trip.

**A configuration error reported itself as a wrong password.** Sign-in briefly
used a scrypt hash in `ADMIN_PASSWORD_HASH`. Every way that value could be
damaged in transit — a plaintext password pasted in by mistake, a hash clipped
by a bad copy, stray quotes carried along — surfaced as `invalid_password`,
which points at the person typing rather than at the deploy. Hours went into
that misdirection.

The hashing was removed rather than patched. With a single admin it bought
little: the rate limit is what actually stops online guessing, and anyone able
to read a hash out of the environment can generally read everything else the
environment holds too. What it cost was a second copy of a secret that had to
be generated by a script, kept in sync between `.env` and Vercel, and matched
exactly — three places for a silent mismatch to hide. `ADMIN_PASSWORD` is a
plain value you can read and compare by eye.

Both bugs failed in a way that pointed somewhere other than the actual cause.
That's the expensive kind, and it's why the error codes above are specific and
why the dashboard prints the server's reason instead of a status number.
