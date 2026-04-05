// ─── Template Installer ──────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

const MARKER_START = "<!-- kanon-mcp-start -->";
const MARKER_END = "<!-- kanon-mcp-end -->";

/**
 * Install a template to the target location.
 *
 * Two strategies:
 * - "marker-inject": Insert content between start/end markers in the target file.
 *   Creates the file if it doesn't exist. Replaces content between markers on re-run.
 * - "file-copy": Copy the template file to the destination, overwriting on re-run.
 */
export function installTemplate(
  templateTarget: string,
  templateSource: string,
  assetsDir: string,
  mode: "marker-inject" | "file-copy",
): void {
  const srcPath = path.join(assetsDir, "templates", templateSource);
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Template source not found: ${srcPath}`);
  }

  const snippet = fs.readFileSync(srcPath, "utf8");
  const targetDir = path.dirname(templateTarget);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  if (mode === "file-copy") {
    fs.writeFileSync(templateTarget, snippet);
    return;
  }

  // marker-inject mode
  if (fs.existsSync(templateTarget)) {
    const content = fs.readFileSync(templateTarget, "utf8");

    if (content.includes(MARKER_START)) {
      // Replace existing section between markers
      const startIdx = content.indexOf(MARKER_START);
      const endIdx = content.indexOf(MARKER_END);
      if (startIdx !== -1 && endIdx !== -1) {
        const before = content.substring(0, startIdx);
        const after = content.substring(endIdx + MARKER_END.length);
        fs.writeFileSync(
          templateTarget,
          before + snippet.trim() + after,
        );
        return;
      }
    }

    // Append with a blank line separator
    const sep = content.endsWith("\n") ? "\n" : "\n\n";
    fs.writeFileSync(templateTarget, content + sep + snippet);
  } else {
    // Create new file with the snippet
    fs.writeFileSync(templateTarget, snippet);
  }
}

/**
 * Remove template content from the target location.
 *
 * - "marker-inject": Remove everything between markers (inclusive).
 * - "file-copy": Delete the target file.
 */
export function removeTemplate(
  templateTarget: string,
  mode: "marker-inject" | "file-copy",
): boolean {
  if (!fs.existsSync(templateTarget)) {
    return false;
  }

  if (mode === "file-copy") {
    fs.rmSync(templateTarget);
    return true;
  }

  // marker-inject mode — remove section between markers
  const content = fs.readFileSync(templateTarget, "utf8");
  if (!content.includes(MARKER_START)) {
    return false;
  }

  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);
  if (startIdx === -1 || endIdx === -1) {
    return false;
  }

  // Remove section and clean up surrounding whitespace
  const before = content.substring(0, startIdx).replace(/\n+$/, "\n");
  const after = content
    .substring(endIdx + MARKER_END.length)
    .replace(/^\n+/, "\n");
  let result = before + after;
  // Clean up excessive blank lines
  result = result.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

  fs.writeFileSync(templateTarget, result);
  return true;
}
