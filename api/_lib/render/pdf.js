import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { existsSync } from "node:fs";

// Common macOS/Linux Chrome locations, tried when running locally (where the
// bundled Lambda chromium binary won't launch). Set CHROME_EXECUTABLE_PATH to
// skip the guesswork.
const LOCAL_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

function localChromePath() {
  if (process.env.CHROME_EXECUTABLE_PATH) return process.env.CHROME_EXECUTABLE_PATH;
  return LOCAL_CHROME_PATHS.find((p) => existsSync(p)) || null;
}

// Resolves a browser launch config that works both on Vercel (serverless Linux,
// via @sparticuz/chromium) and on a local dev machine (system Chrome).
async function launchOptions() {
  const local = localChromePath();
  if (local) {
    return { args: ["--no-sandbox"], executablePath: local, headless: true };
  }
  // Serverless: use the bundled, Lambda-compatible Chromium.
  return {
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
    defaultViewport: chromium.defaultViewport,
  };
}

// Renders a full HTML document to a PDF Buffer. `options` is passed to
// page.pdf() — callers set format/landscape/margins per document.
export async function htmlToPdf(html, options = {}) {
  const browser = await puppeteer.launch(await launchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    return await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      ...options,
    });
  } finally {
    await browser.close();
  }
}
