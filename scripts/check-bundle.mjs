// Fails the build if the code a customer downloads grows past its budget (gzip sizes).
// Keeps the QR-scan → card experience fast on cheap phones and slow networks.
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const dir = "dist/client/assets";
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
const kb = (f) => gzipSync(readFileSync(`${dir}/${f}`)).length / 1024;
const find = (prefix) => files.find((f) => f.startsWith(prefix));

// Startup code everyone downloads, plus each customer page's own chunk.
const budgets = [
  { label: "startup (index)", file: find("index-"), maxKb: 95 },
  { label: "customer cards page", file: find("customer-"), maxKb: 15 },
  { label: "shop page", file: find("public-business-"), maxKb: 10 },
  // Landing page incl. its 3D (CSS-only, no 3D library) — visitors on mobile data see it first.
  { label: "landing page", file: find("landing-"), maxKb: 18 },
];

let failed = false;
for (const b of budgets) {
  if (!b.file) {
    console.error(`✗ ${b.label}: chunk not found`);
    failed = true;
    continue;
  }
  const size = kb(b.file);
  const ok = size <= b.maxKb;
  if (!ok) failed = true;
  console.log(`${ok ? "✓" : "✗"} ${b.label}: ${size.toFixed(1)} KB gzip (budget ${b.maxKb} KB)`);
}
const total = files.reduce((n, f) => n + kb(f), 0);
console.log(`  all JS chunks together: ${total.toFixed(0)} KB gzip across ${files.length} files (only what a page needs is downloaded)`);
if (failed) {
  console.error("\nBundle budget exceeded. Lazy-load the new code or raise the budget on purpose.");
  process.exit(1);
}
