import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", e => console.log("[pageerror]", e.message));

await page.goto("http://localhost:8765/Kanon%20Redesign.html", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);  // give babel-standalone time

// Try to navigate via keyboard shortcut "G R" (per design chat: G I/R/D/B/C)
await page.keyboard.press("g");
await page.waitForTimeout(80);
await page.keyboard.press("r");
await page.waitForTimeout(1500);

// Click Timeline tab
const tlBtn = await page.$('button:has-text("Timeline")');
if (tlBtn) { await tlBtn.click(); await page.waitForTimeout(1500); }

// Try to switch to Mono via tweaks panel — find by aria/title
const tweaks = await page.$('button[title*="tweak" i], button[aria-label*="tweak" i], button:has-text("Tweaks")');
if (tweaks) await tweaks.click();
await page.waitForTimeout(300);
const mono = await page.$('button:has-text("Mono")');
if (mono) { await mono.click(); await page.waitForTimeout(400); }
const dark = await page.$('button:has-text("Dark")');
if (dark) { await dark.click(); await page.waitForTimeout(400); }

await page.screenshot({ path: "/tmp/timeline-design.png", fullPage: false });
console.log("URL:", page.url());
await browser.close();
