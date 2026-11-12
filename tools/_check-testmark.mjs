// Scratch: proves the "test" marker renders in the order row and the drawer,
// and measures it against its backdrop.
//
// The is_test column needs migration 0003 applied before the API can return the
// flag, so this serves a canned two-order list instead: one test, one real. It
// checks the render, which is the part that can be wrong independently of the
// database, and it stays deterministic once the column does exist.
//
// Usage: node tools/_check-testmark.mjs   (needs `npm start` running)
import puppeteer from "puppeteer-core";

process.loadEnvFile(".env");
const BASE = "http://localhost:3000";
const OUT = "/tmp/admin-shots";

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_EXECUTABLE_PATH,
  headless: "new",
  args: ["--window-size=1440,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

const FIXTURE = (() => {
  const order = (n, isTest, name, city) => ({
    orderId: String(9000 + n), orderName: "#" + (1900 + n),
    createdAt: new Date().toISOString(), receivedAt: new Date().toISOString(),
    status: "new", checklist: {}, isTest,
    customer: { name, email: "x@example.com" },
    shipping: { name, address1: "1 Main St", city, province: "North Carolina", zip: "28801", country: "United States" },
    items: [{
      lineItemId: "1", title: "Custom Quilt Kit", variantTitle: "Baby", quantity: 1,
      sku: "KIT-QUILT-BABY", designId: "d" + n, designFound: true, type: "quilt",
      bom: { categories: [] }, extras: [],
    }],
  });
  return { orders: [order(1, true, "Wren Callaway", "Asheville"), order(2, false, "Iris Mbeki", "Durham")] };
})();

await page.evaluateOnNewDocument((fixture) => {
  const real = window.fetch;
  window.fetch = async (...args) => {
    const url = String(args[0]?.url || args[0] || "");
    const method = (args[1]?.method || args[0]?.method || "GET").toUpperCase();
    if (method !== "GET" || !url.includes("/api/admin/orders")) return real(...args);
    return new Response(JSON.stringify(fixture), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
}, FIXTURE);

await page.goto(`${BASE}/admin.html`, { waitUntil: "domcontentloaded" });
await page.evaluate((tok) => {
  localStorage.setItem("studio_admin_session",
    JSON.stringify({ token: tok, expiresAt: Date.now() + 864e5 }));
}, process.env.ADMIN_TOKEN);
await page.goto(`${BASE}/admin.html`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 700));

const marks = await page.$$(".testmark");
console.log(`rows carrying a marker: ${marks.length} (expect exactly 1)`);
if (marks.length !== 1) throw new Error("marker did not render on exactly one row");

// Contrast of the label against whatever it actually sits on, composited.
const measured = await page.evaluate(() => {
  const el = document.querySelector(".testmark");
  const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  let bg = [0, 0, 0, 0], node = el;
  while (node && bg[3] === 0) {
    const c = parse(getComputedStyle(node).backgroundColor);
    if ((c[3] ?? 1) > 0) bg = [c[0], c[1], c[2], c[3] ?? 1];
    node = node.parentElement;
  }
  const fg = parse(getComputedStyle(el).color);
  const a = fg[3] ?? 1;
  const over = fg.slice(0, 3).map((v, i) => a * v + (1 - a) * bg[i]);
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [l1, l2] = [lum(over), lum(bg.slice(0, 3))].sort((x, y) => y - x);
  return {
    ratio: +((l1 + 0.05) / (l2 + 0.05)).toFixed(2),
    size: getComputedStyle(el).fontSize,
    text: el.textContent,
  };
});
console.log(`label "${measured.text}" at ${measured.size} — contrast ${measured.ratio}:1 (need 4.5)`);
if (measured.ratio < 4.5) throw new Error("test marker is under-contrast");

await page.screenshot({ path: `${OUT}/testmark-row.png`, clip: { x: 232, y: 150, width: 700, height: 190 } });

await page.evaluate(() => document.querySelector(".tr.row").click());
await new Promise((r) => setTimeout(r, 600));
const inDrawer = await page.$$eval(".drawer-head .testmark", (n) => n.length);
console.log(`drawer header carries a marker: ${inDrawer === 1}`);
if (inDrawer !== 1) throw new Error("drawer header did not show the marker");
const box = await page.$eval(".drawer-head", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
await page.screenshot({ path: `${OUT}/testmark-drawer.png`, clip: box });

console.log("shots in " + OUT);
await browser.close();
