export function sourceUrlFromRef(sourceType: string, sourceRef: string | null): string | null {
  if (sourceType !== "web" || !sourceRef) return null;
  try {
    const url = new URL(sourceRef);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function sourceHostLabel(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}
