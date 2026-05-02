import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await page.goto("http://localhost:5173/login", { waitUntil: "domcontentloaded" });
await page.fill('input[type="email"]', "dev@kanon.io");
await page.fill('input[type="password"]', "Password1!");
await page.click('button[type="submit"]');
await page.waitForTimeout(1500);
await page.goto("http://localhost:5173/roadmap/KAN", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const tab = await page.$('button:has-text("Timeline")');
if (tab) { await tab.click(); await page.waitForTimeout(1500); }
await page.screenshot({ path: "/tmp/timeline-final.png", fullPage: false });

// hover one bar to check hover-dim + edge highlight
const bar = await page.$('[data-testid^="timeline-bar"]');
if (bar) { await bar.hover(); await page.waitForTimeout(500); await page.screenshot({ path: "/tmp/timeline-hover.png", fullPage: false }); }
console.log("done");
await browser.close();
