import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
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
await page.screenshot({ path: "/tmp/analytics-current.png", fullPage: true });
console.log("done");
await browser.close();
