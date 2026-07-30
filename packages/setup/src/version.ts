import fs from "node:fs";

const pkg = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export const SETUP_VERSION: string = pkg.version;
