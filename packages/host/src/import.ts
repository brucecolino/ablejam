// Extracts setlist text from pasted text / uploaded files (txt, pdf, docx).

export async function extractText(filename: string, dataBase64: string): Promise<string> {
  const buf = Buffer.from(dataBase64, "base64");
  const ext = filename.toLowerCase().split(".").pop() ?? "";

  if (ext === "pdf") {
    // Import the inner module to skip pdf-parse's index.js debug self-test.
    const mod = (await import("pdf-parse/lib/pdf-parse.js")) as unknown as { default?: (b: Buffer) => Promise<{ text: string }> };
    const pdf = (mod.default ?? (mod as unknown)) as (b: Buffer) => Promise<{ text: string }>;
    const res = await pdf(buf);
    return res.text ?? "";
  }
  if (ext === "docx") {
    const mod = (await import("mammoth")) as unknown as {
      default?: { extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }> };
      extractRawText?: (o: { buffer: Buffer }) => Promise<{ value: string }>;
    };
    const mammoth = mod.default ?? mod;
    const res = await mammoth.extractRawText!({ buffer: buf });
    return res.value ?? "";
  }
  return buf.toString("utf8");
}

export function textToTitles(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
