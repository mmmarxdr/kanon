import { chromium } from "@playwright/test";
import fs from "node:fs";

const TARGETS = [
  // Linear — engineering PM peer; product visuals on marketing site
  { name: "linear-method",        url: "https://linear.app/method" },
  { name: "linear-features",      url: "https://linear.app/features" },
  { name: "linear-project-updates", url: "https://linear.app/features/project-updates" },
  // Atlassian Jira — incumbent
  { name: "jira-roadmaps",        url: "https://www.atlassian.com/agile/project-management/roadmaps" },
  { name: "jira-timeline",        url: "https://www.atlassian.com/software/jira/features/timeline" },
  { name: "jira-reports",         url: "https://www.atlassian.com/software/jira/features/reports" },
  // Productboard — roadmap-first analytics
  { name: "productboard-roadmap", url: "https://www.productboard.com/product/roadmap/" },
  // Aha — roadmap analytics
  { name: "aha-roadmaps",         url: "https://www.aha.io/roadmaps" },
  // Asana Timeline
  { name: "asana-timeline",       url: "https://asana.com/uses/timeline" },
];

const outDir = "/tmp/competitor-shots";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
});

for (const t of TARGETS) {
  const page = await ctx.newPage();
  try {
    console.log("→", t.name, t.url);
    await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(2500);
    // dismiss obvious cookie banners
    for (const sel of ['button:has-text("Accept all")','button:has-text("Accept")','button:has-text("Got it")','button:has-text("OK")','button:has-text("I agree")']) {
      const btn = await page.$(sel);
      if (btn) { try { await btn.click({ timeout: 1500 }); break; } catch {} }
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/${t.name}.png`, fullPage: false });
    console.log("  ok");
  } catch (err) {
    console.log("  FAIL", err.message.split("\n")[0]);
  } finally {
    await page.close();
  }
}

await browser.close();
console.log("\nSaved to", outDir);
fs.readdirSync(outDir).forEach(f => console.log("  -", f));
