import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("http://localhost:5173/login", { waitUntil: "domcontentloaded" });
await page.fill('input[type="email"]', "dev@kanon.io");
await page.fill('input[type="password"]', "Password123!");
await page.click('button[type="submit"]');
await page.waitForTimeout(1500);
await page.goto("http://localhost:5173/roadmap/KAN", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const tab = await page.$('button:has-text("Analytics")');
if (tab) { await tab.click(); await page.waitForTimeout(1500); }

// scroll to bottom
const container = await page.$('main, .flex.flex-col.gap-4');
await page.evaluate(() => {
  const el = document.querySelector('.overflow-y-auto');
  if (el) el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/analytics-bottom.png", fullPage: false });

// also capture full-page top view
await page.evaluate(() => {
  const el = document.querySelector('.overflow-y-auto');
  if (el) el.scrollTop = 0;
});
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/analytics-top.png", fullPage: false });

console.log("done");
await browser.close();
