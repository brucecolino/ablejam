// Azure AI Speech "Fast transcription" (official REST). Transcribes a WHOLE audio file (WAV/MP3/
// FLAC/OPUS…) and returns each recognized phrase with file-relative timestamps, so AbleJam can turn
// a recorded SPEECH track into STRUCTURE markers — one call per source file, mapped to clips by time.
// Uses the SAME key + region as the Azure TTS voices; the free tier applies.
import { readFileSync } from "node:fs";
import path from "node:path";

export interface FastPhrase {
  text: string;
  offsetSec: number;   // start of the phrase within the source file
  durationSec: number;
  confidence: number;  // 0..1
}

/** Fast-transcribe a whole audio file. `locales` are BCP-47 candidates (e.g. ["it-IT"]); an EMPTY
 * array turns on multilingual auto-detection (best for mixed IT/EN speech). `phrases` biases
 * recognition toward the known labels. Returns the phrases (empty if no speech) or null on error. */
export async function azureFastTranscribe(
  key: string, region: string, filePath: string, locales: string[], phrases: string[],
): Promise<FastPhrase[] | null> {
  if (!key || !region) return null;
  let body: Buffer;
  try { body = readFileSync(filePath); } catch { return null; }
  if (body.length < 64) return null;
  if (body.length > 240 * 1024 * 1024) { console.error(`[azure] fast-stt file too large: ${filePath}`); return null; }

  // Region host form (reuses the short settings.azureRegion — no extra config). Documented as accepted.
  const url = `https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;
  const definition = {
    locales,                     // [] → multilingual auto-detect; else candidate languages
    profanityFilterMode: "None", // don't mask short section words ("stop", exclamations)
    phraseList: { phrases: phrases.slice(0, 500) }, // biasing — array of strings only
  };

  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === "mp3" ? "audio/mpeg" : ext === "flac" ? "audio/flac"
    : (ext === "ogg" || ext === "opus") ? "audio/ogg" : (ext === "aif" || ext === "aiff") ? "audio/aiff" : "audio/wav";
  // A Blob from the Buffer copies exactly the view's bytes (respects byteOffset/length), no pooled tail.
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(body)], { type: mime }), `audio.${ext || "wav"}`);
  form.append("definition", JSON.stringify(definition));

  let res: Response;
  try {
    // Let fetch/undici set the multipart boundary — do NOT set Content-Type by hand.
    res = await fetch(url, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key, "Accept": "application/json" },
      body: form as unknown as BodyInit,
    });
  } catch (e) {
    console.error("[azure] fast-stt network error:", (e as Error).message);
    return null;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[azure] fast-stt HTTP ${res.status} (region "${region}", locales "${locales.join(",") || "auto"}") ${detail.slice(0, 300)}`);
    return null;
  }
  let json: Record<string, unknown>;
  try { json = (await res.json()) as Record<string, unknown>; } catch { return null; }
  // TranscribeResult: { durationMilliseconds, combinedPhrases[], phrases[] }; each phrase has
  // { offsetMilliseconds, durationMilliseconds, text, locale, confidence }.
  const arr = Array.isArray(json.phrases) ? (json.phrases as Array<Record<string, unknown>>) : [];
  return arr.map((p) => ({
    text: String(p.text ?? "").trim(),
    offsetSec: (Number(p.offsetMilliseconds) || 0) / 1000,
    durationSec: (Number(p.durationMilliseconds) || 0) / 1000,
    confidence: Number(p.confidence) || 0,
  })).filter((p) => p.text.length > 0);
}
