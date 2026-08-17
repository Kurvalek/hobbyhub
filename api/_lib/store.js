import { adminSupabase, userSupabase } from "./supabase.js";

// Saved designs, backed by the `public.designs` table.
//
// Two access paths on purpose:
//   • Owned library reads/writes go through userSupabase(req), so Postgres RLS
//     — not this file — is what actually enforces "only your own rows". A bug
//     here can't leak someone else's library.
//   • getDesign(id) goes through the service role because the uuid IS the
//     capability: a purchased kit must stay resolvable for fulfillment (Shopify
//     webhook, admin PDF render) even though the buyer usually isn't the
//     design's owner. Ids are 122 random bits and are never enumerated.

const COLUMNS = "id, user_id, type, name, data, created_at, updated_at";

// Postgres snake_case → the camelCase record shape the studio and the render
// modules already expect.
function toRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    name: row.name ?? null,
    ownerId: row.user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    data: row.data,
  };
}

// A design's display name lives inside the payload the studio sends; mirroring
// it into its own column keeps it readable in the Supabase table editor.
function nameFrom(data) {
  const name = data?.name;
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 200) : null;
}

// Returns the stored record, or null if no design exists for this id.
export async function getDesign(id) {
  const { data, error } = await adminSupabase()
    .from("designs")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return toRecord(data);
}

export async function listUserDesigns(req) {
  const { data, error } = await userSupabase(req)
    .from("designs")
    .select(COLUMNS)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(toRecord);
}

// `user` is null for a guest saving a design purely so a kit order has something
// to point at. Those rows stay unowned (user_id null) and are written with the
// service role, since RLS gives anonymous callers no insert path.
export async function createDesign(req, user, { type, data }) {
  const client = user ? userSupabase(req) : adminSupabase();
  const row = { user_id: user?.id ?? null, type, name: nameFrom(data), data };
  const { data: inserted, error } = await client
    .from("designs")
    .insert(row)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toRecord(inserted);
}

// Update in place. Scoped to the caller by RLS, so a row belonging to someone
// else simply matches nothing — indistinguishable from "not found", which is
// the behavior we want.
export async function updateOwnedDesign(req, id, { data }) {
  const { data: updated, error } = await userSupabase(req)
    .from("designs")
    .update({ data, name: nameFrom(data) })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return toRecord(updated);
}

// Returns true when a row was actually removed. Same RLS scoping as above.
export async function deleteOwnedDesign(req, id) {
  const { data, error } = await userSupabase(req)
    .from("designs")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  return (data || []).length > 0;
}
