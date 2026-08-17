# Supabase setup

Everything that used to live in Upstash Redis (accounts, saved designs, the order
queue) now lives in Supabase. Five steps, about ten minutes.

Step 3 is the one people miss: **without the `{{ .Token }}` edit, Supabase sends
a magic link and no 6-digit code**, and the studio's Save overlay has nothing to
verify.

---

## 1. Run the SQL

Supabase dashboard → **SQL Editor** → **New query** → paste all of
`supabase/migrations/0001_init.sql` → **Run**.

It creates `profiles`, `designs`, `orders`, `order_items`, the `updated_at`
triggers, the trigger that creates a profile row on signup, and the Row Level
Security policies. It's written to be safely re-runnable, so you can paste it
again after editing it without losing rows.

Check it worked: **Table Editor** should show all four tables, each with an
"RLS enabled" badge.

## 2. Turn on email auth

**Authentication → Sign In / Providers → Email**

- **Enable email provider**: on
- **Confirm email**: **off**. The 6-digit code *is* the confirmation — leaving
  this on adds a second, redundant click-a-link step before the account works.
- **Enable email OTP** (if your dashboard shows it separately): on
- **Email OTP expiration**: 600 seconds (10 minutes) is a good default. The
  overlay tells people the code "expires shortly" rather than naming a number, so
  you can change this freely.

You do not need to enable any other provider. There are no passwords in this app.

## 3. Put `{{ .Token }}` in the email template ← the one that trips people up

**Authentication → Emails → Templates → Magic Link**

`signInWithOtp` sends the **Magic Link** template. By default that template only
contains `{{ .ConfirmationURL }}` — a link, no code. Add `{{ .Token }}` so the
email actually carries the six digits:

```html
<h2>Your metime code</h2>
<p style="font-size:32px;letter-spacing:0.2em"><strong>{{ .Token }}</strong></p>
<p>Type it into the studio to save your design. It expires shortly.</p>
```

Keeping `{{ .ConfirmationURL }}` in the template as well is harmless, but the
studio doesn't handle the link click (`detectSessionInUrl` is off), so it's
cleaner to drop it and leave only the code.

Save the template, then send yourself a code from the studio's Save button and
confirm the email shows six digits.

## 4. Set the URLs

**Authentication → URL Configuration**

- **Site URL**: the studio's real origin, e.g. `https://studio.example.com`
- **Redirect URLs**: add the same origin, plus `http://localhost:3000` for
  `vercel dev`

These matter less than usual here — the OTP code flow doesn't redirect anywhere —
but Supabase uses Site URL when building the link half of the email, so set it or
that link points at localhost.

## 5. Paste the keys in two places

**Project Settings → API** has all three values.

**A. `index.html`** — near the top of the `<script type="text/babel">` block,
in the "Supabase config" comment block:

```js
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";  // ← Project URL
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";            // ← anon public
```

The anon key belongs in this file. It's public/client-safe in exactly the way the
Shopify Storefront token is: it grants only what Row Level Security allows, which
here is "a signed-in user's own designs, nothing else."

**B. Vercel env vars** (Project → Settings → Environment Variables) for
Production, Preview, and Development — and a local `.env` for `vercel dev`:

| Variable | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | Project URL | same as above |
| `SUPABASE_ANON_KEY` | anon public key | same as above |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** key | server only — never commit, never send to a browser |

The service role key bypasses RLS entirely. It's used by the Shopify webhook, the
admin dashboard, and the by-id design read that fulfillment depends on. If it
leaks, rotate it in **Project Settings → API → Reset**.

Until all three server vars are set, the `/api/designs` and `/api/admin/*`
endpoints answer `503 supabase_not_configured` instead of failing obscurely, and
the studio itself falls back to saving designs on the device only.

---

## How the pieces fit

**Guest → Save → cross-device reopen**

1. A guest designs freely: draw, recolor, resize, download PDFs, buy a kit. No
   account, nothing asked.
2. Clicking **Save** (and naming the design) is the only account wall. The design
   is stashed in `sessionStorage`, and the Save overlay asks for an email.
3. `signInWithOtp` mails a 6-digit code. They type it; `verifyOtp` exchanges it
   for a session that supabase-js stores and refreshes in the browser.
4. The stashed design is POSTed to `/api/designs` with the session's access token
   in an `Authorization: Bearer` header, so it's inserted with
   `user_id = auth.uid()`.
5. On any other device, signing in with the same email loads the same library —
   `GET /api/designs` reads through RLS, so it can only ever return their rows.

**Existing designs on their current browser**

The first time someone signs in on a device that already has designs in
localStorage, the studio uploads all of them into the new account, then marks
that device done with a `metime.claimed.<user id>` flag so signing in again never
duplicates them. A design that was already uploaded anonymously for a kit order
gets an owned *copy*; the original row stays put so the existing order still
resolves.

**Guest kit checkout still works**

`designs.user_id` is nullable on purpose. A guest buying a kit POSTs their design
unowned so the Shopify order has a uuid to point at. That's also why
`GET /api/designs/[id]` reads with the service role and doesn't check ownership:
the buyer of a kit isn't necessarily the designer, and fulfillment has to be able
to render the chart. **The uuid is the capability** — 122 random bits, never
listed anywhere.

**Orders**

`orders` and `order_items` have RLS on with zero policies, so the browser can't
touch them at all. The HMAC-verified Shopify webhook and the `ADMIN_TOKEN`-gated
admin endpoints reach them with the service role. The webhook upserts on
`shopify_order_id` and deliberately leaves `status`, `checklist`, and
`received_at` alone, so a redelivered webhook can't wipe fulfillment progress.

**Stripe**

Not built. `profiles.stripe_customer_id` is reserved for it and stays null.
Stripe is never the login.
