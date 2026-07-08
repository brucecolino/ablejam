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

export interface FastResult { phrases: FastPhrase[]; error?: string }

/** Fast-transcribe a whole audio file. `locales` are BCP-47 candidates (e.g. ["it-IT"]); an EMPTY
 * array turns on multilingual auto-detection (best for mixed IT/EN speech). `phrases` biases
 * recognition toward the known labels. Returns { phrases } on success, or { phrases:[], error } so
 * the caller can surface WHY (bad key/region/endpoint, unsupported file, …) in the in-app Log. */
export async function azureFastTranscribe(
  key: string, region: string, filePath: string, locales: string[], phrases: string[],
): Promise<FastResult> {
  if (!key || !region) return { phrases: [], error: "no Azure key/region" };
  let body: Buffer;
  try { body = readFileSync(filePath); } catch { return { phrases: [], error: "cannot read the file on disk" }; }
  if (body.length < 64) return { phrases: [], error: "file is empty/too small" };
  if (body.length > 240 * 1024 * 1024) return { phrases: [], error: "file larger than 240 MB" };

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
    return { phrases: [], error: `network error (${(e as Error).message})` };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { phrases: [], error: `HTTP ${res.status} — ${detail.slice(0, 200) || "(no body)"}` };
  }
  let json: Record<string, unknown>;
  try { json = (await res.json()) as Record<string, unknown>; } catch { return { phrases: [], error: "invalid JSON response" }; }
  // TranscribeResult: { durationMilliseconds, combinedPhrases[], phrases[] }; each phrase has
  // { offsetMilliseconds, durationMilliseconds, text, locale, confidence }.
  const arr = Array.isArray(json.phrases) ? (json.phrases as Array<Record<string, unknown>>) : [];
  return {
    phrases: arr.map((p) => ({
      text: String(p.text ?? "").trim(),
      offsetSec: (Number(p.offsetMilliseconds) || 0) / 1000,
      durationSec: (Number(p.durationMilliseconds) || 0) / 1000,
      confidence: Number(p.confidence) || 0,
    })).filter((p) => p.text.length > 0),
  };
}
