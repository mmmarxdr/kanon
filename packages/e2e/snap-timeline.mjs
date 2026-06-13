import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Login
await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" });
await page.fill('input[type="email"]', "dev@kanon.io");
await page.fill('input[type="password"]', "Password123!");
await page.click('button[type="submit"]');
await page.waitForURL(/.*\/(workspace|inbox|kanon-dev).*/i, { timeout: 15000 });

// Go to roadmap timeline
await page.goto("http://localhost:5173/roadmap/KAN", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// Try to click Timeline tab — different possible selectors
const tabSelectors = [
  'button:has-text("Timeline")',
  '[role="tab"]:has-text("Timeline")',
  'a:has-text("Timeline")',
];
let clicked = false;
for (const sel of tabSelectors) {
  const el = await page.$(sel);
  if (el) { await el.click(); clicked = true; console.log("clicked:", sel); break; }
}
if (!clicked) console.log("Timeline tab selector not found; staying on default");

await page.waitForTimeout(1500);

await page.screenshot({ path: "/tmp/timeline-current.png", fullPage: true });
const url = page.url();
const html = await page.content();
console.log("URL:", url);
console.log("HTML length:", html.length);

// Dump key dom info
const info = await page.evaluate(() => {
  const main = document.querySelector("main") || document.body;
  return {
    bg: getComputedStyle(document.documentElement).getPropertyValue("--bg") || "(none)",
    accent: getComputedStyle(document.documentElement).getPropertyValue("--accent") || "(none)",
    ink: getComputedStyle(document.documentElement).getPropertyValue("--ink") || "(none)",
    panel: getComputedStyle(document.documentElement).getPropertyValue("--panel") || "(none)",
    line: getComputedStyle(document.documentElement).getPropertyValue("--line") || "(none)",
    bodyBg: getComputedStyle(document.body).backgroundColor,
    visibleText: main.innerText.slice(0, 800),
  };
});
console.log(JSON.stringify(info, null, 2));

await browser.close();
