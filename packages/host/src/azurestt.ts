// Azure Cognitive Services Speech-to-Text (official REST, short audio). Transcribes a short spoken
// clip (a section label / song title) to text so AbleJam can turn a recorded SPEECH track into
// STRUCTURE markers. Uses the SAME key + region as the Azure TTS voices; the free tier applies.
import { readFileSync } from "node:fs";

export interface AzureRecognition { display: string; lexical: string; confidence: number }

/** Transcribe a 16 kHz mono 16-bit PCM WAV via the Azure short-audio endpoint. `locale` is REQUIRED
 * (e.g. "it-IT" / "en-US") — omitting it returns a 4xx. Returns null on NoMatch / network / non-200. */
export async function azureRecognize(
  key: string, region: string, wavPath: string, locale: string,
): Promise<AzureRecognition | null> {
  if (!key || !region) return null;
  let body: Buffer;
  try { body = readFileSync(wavPath); } catch { return null; }
  if (body.length < 64) return null;
  // fetch's BodyInit type doesn't include Node's Buffer; a plain Uint8Array view (no copy) is accepted.
  const bodyBytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`
    + `?language=${encodeURIComponent(locale || "it-IT")}&format=detailed&profanity=raw`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
        "Accept": "application/json",
        "User-Agent": "AbleJam",
      },
      body: bodyBytes as unknown as BodyInit,
    });
  } catch (e) {
    console.error("[azure] stt network error:", (e as Error).message);
    return null;
  }
  if (!res.ok) { console.error(`[azure] stt HTTP ${res.status} (region "${region}", locale "${locale}")`); return null; }
  let json: Record<string, unknown>;
  try { json = (await res.json()) as Record<string, unknown>; } catch { return null; }
  if (String(json.RecognitionStatus ?? "") !== "Success") return null; // NoMatch / InitialSilenceTimeout / Error
  const nbest = Array.isArray(json.NBest) ? (json.NBest as Array<Record<string, unknown>>) : [];
  const top = nbest[0];
  if (!top) return null;
  return {
    display: String(top.Display ?? top.Lexical ?? ""),
    lexical: String(top.Lexical ?? ""),
    confidence: Number(top.Confidence) || 0,
  };
}
