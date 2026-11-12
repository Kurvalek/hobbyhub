// Scratch: exercises the bulk selection bar in admin.html and writes
// screenshots to /tmp/admin-bulk. Seeds a throwaway order so the delete path
// is tested for real rather than mocked.
//
// Usage: node tools/_shot-admin-bulk.mjs   (needs `npm start` running)
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

process.loadEnvFile(".env");
const OUT = "/tmp/admin-bulk";
const BASE = "http://localhost:3000";
const AUTH = { Authorization: "Bearer " + process.env.ADMIN_TOKEN, "Content-Type": "application/json" };
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (path, opts) => fetch(BASE + path, { headers: AUTH, ...opts });

// The delete path is exercised for real, so this script seeds its own order and
// destroys only that one. It used to delete whatever sat last in the list on the
// assumption that it was a spare seed; it was not, and it took real orders with
// it. Nothing already in the table is ever a candidate now.
const existingBefore = new Set(
  (await (await api("/api/admin/orders")).json()).orders.map((o) => String(o.orderId)));

const seeded = execFileSync("node", ["tools/seed-order.mjs"], { encoding: "utf8" });
const seededName = (seeded.match(/Order (#\d+) accepted/) || [])[1];
if (!seededName) throw new Error("could not seed a throwaway order:\n" + seeded);
console.log("seeded throwaway order", seededName);

const before = await (await api("/api/admin/orders")).json();
const victim = before.orders.find((o) => o.orderName === seededName);
if (!victim || existingBefore.has(String(victim.orderId))) {
  throw new Error(`refusing to run: ${seededName} is not a row this script created`);
}
console.log("orders before:", before.orders.map(o => o.orderName + "/" + o.status).join(", "));

// Two orders in the same state, so the primary button can name its target, and
// one shipped, which has nowhere to go and must disable it. Heads up: this does
// rewrite the status of two existing orders. That is reversible from the
// dashboard, unlike the delete below, which is confined to the seeded row.
const others = before.orders.filter((o) => o.orderId !== victim.orderId);
for (const o of others.slice(0, 2)) {
  await api("/api/admin/orders/" + o.orderId, { method: "PATCH", body: JSON.stringify({ status: "new" }) });
}
await api("/api/admin/orders/" + victim.orderId, { method: "PATCH", body: JSON.stringify({ status: "shipped" }) });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_EXECUTABLE_PATH,
  headless: "new",
  args: ["--window-size=1440,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("  shot " + n); };
const barText = () => page.$eval(".selbar", (e) => e.innerText.replace(/\n/g, " | ")).catch(() => "(no bar)");
// Read the badge, not the row text — the advance button names a status too.
const statuses = () => page.$$eval(".tr.row", (els) => els.map((e) =>
  e.querySelector(".ordno").textContent + "=" + e.querySelector(".badge").textContent).join(", "));
// Each click re-renders the table, so the next checkbox has to be re-queried.
const tick = async (pred) => {
  const rows = await page.$$(".tr.row");
  for (const r of rows) {
    if (await r.evaluate((e, p) => e.innerText.includes(p), pred)) {
      await (await r.$(".pick input")).click();
      await sleep(200);
      return;
    }
  }
  throw new Error("no row matching " + pred);
};

await page.goto(`${BASE}/admin.html`, { waitUntil: "domcontentloaded" });
await page.evaluate((t) => localStorage.setItem("studio_admin_session",
  JSON.stringify({ token: t, expiresAt: Date.now() + 864e5 })), process.env.ADMIN_TOKEN);
await page.goto(`${BASE}/admin.html`, { waitUntil: "networkidle0" });
await page.waitForSelector(".tr.row");

console.log("\n=== no selection: bar hidden ===");
console.log("bar:", await barText());

console.log("\n=== select two 'new' orders ===");
console.log("statuses:", await statuses());
await tick(before.orders[0].orderName);
await tick(before.orders[1].orderName);
console.log("bar:", await barText());
console.log("select-all indeterminate:", await page.$eval(".tr.head .pick input", (e) => e.indeterminate));
await shot("01-selected");

console.log("\n=== 'Move to…' menu ===");
await page.$$eval(".selbar .menu > .btn", (e) => e[0].click());
await sleep(250);
console.log("menu items:", await page.$$eval(".menu-pop button", (els) =>
  els.map((e) => e.textContent + (e.disabled ? "[disabled]" : "")).join("  ")));
await shot("02-menu");
await page.keyboard.press("Escape");
await sleep(200);
console.log("menu after Escape:", await page.$$(".menu-pop").then((e) => e.length));

console.log("\n=== primary advance ===");
console.log("primary label:", await page.$eval(".selbar .btn.accent", (e) => e.textContent));
await page.click(".selbar .btn.accent");
await sleep(2500);
console.log("statuses now:", await statuses());
console.log("bar:", await barText());
await shot("03-advanced");

console.log("\n=== select all, mixed statuses ===");
await page.$eval(".tr.head .pick input", (e) => e.click());
await sleep(300);
console.log("bar:", await barText());
console.log("select-all checked:", await page.$eval(".tr.head .pick input", (e) => e.checked));
await shot("04-selectall");

console.log("\n=== selection prunes on tab switch ===");
await page.$$eval(".tab", (els) => els.find((e) => e.textContent.startsWith("Shipped")).click());
await sleep(300);
console.log("bar on Shipped tab:", await barText());
console.log("rows on Shipped tab:", (await page.$$(".tr.row")).length);
// Shipped has nowhere to go, so the primary must be disabled — and, since the
// cursor is parked on it from the click above, still legible.
await page.hover(".selbar .btn.accent");
console.log("primary disabled:", await page.$eval(".selbar .btn.accent", (e) => e.disabled));
console.log("primary colours while hovered+disabled:", await page.$eval(".selbar .btn.accent", (e) => {
  const s = getComputedStyle(e);
  return { text: e.textContent, color: s.color, background: s.backgroundColor };
}));
await shot("05-pruned");
await page.$$eval(".tab", (els) => els.find((e) => e.textContent.startsWith("All")).click());
await sleep(300);
await page.$$eval(".selbar .btn", (els) => els.find((e) => e.textContent === "Clear").click());
await sleep(250);
console.log("bar after Clear:", await barText());

console.log("\n=== delete confirm ===");
// Only ever the order this script seeded, never a pre-existing row.
const target = victim;
await tick(target.orderName);
await page.click(".selbar .btn.danger");
await sleep(300);
console.log("confirm bar:", await barText());
await shot("06-confirm");

console.log("\n=== cancel, then delete for real ===");
await page.$$eval(".selbar .btn", (els) => els.find((e) => e.textContent === "Cancel").click());
await sleep(250);
console.log("bar after cancel:", await barText());
await page.click(".selbar .btn.danger");
await sleep(300);
await page.$$eval(".selbar .btn", (els) => els.find((e) => e.textContent.startsWith("Delete 1")).click());
await sleep(2500);
console.log("rows after delete:", await page.$$eval(".tr.row", (els) => els.map((e) => e.innerText.split("\n")[0]).join(", ")));
console.log("bar:", await barText());
await shot("07-deleted");

const after = await (await api("/api/admin/orders")).json();
console.log("server rows after delete:", after.orders.map((o) => o.orderName).join(", "));
console.log("deleted from database:", !after.orders.some((o) => o.orderId === target.orderId));

console.log("\n=== mobile bar ===");
await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
await sleep(300);
await (await (await page.$(".tr.row")).$(".pick input")).click();
await sleep(300);
console.log("bar:", await barText());
console.log("overflow:", await page.evaluate(() =>
  ({ doc: document.documentElement.scrollWidth, win: window.innerWidth })));
await shot("08-mobile");

console.log("\nconsole errors:", errors.length ? errors : "none");
await browser.close();
