// §11 Rendering — shared banner utilities.
//
// The banner is a comment block prepended to emitted Markdown so humans see at
// a glance that the file is a derived projection (I7, NG2). `stripBanner` is
// used by compareMarkdown to ignore banner lines when comparing emitted output
// against a reference fixture.

export const GENERATED_BANNER =
  "<!-- GENERATED FILE — do not edit. Regenerate from the canonical corpus module. -->";

export function stripBanner(text: string): string {
  const lines = text.split("\n");
  const cleaned: string[] = [];
  let inBanner = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("<!--") && trimmed.includes("GENERATED")) {
      inBanner = !trimmed.endsWith("-->");
      continue;
    }
    if (inBanner) {
      if (trimmed.endsWith("-->")) {
        inBanner = false;
      }
      continue;
    }
    cleaned.push(line);
  }
  return cleaned.join("\n").replace(/^\n+/, "");
}
