// Azure Cognitive Services Speech (official REST TTS). Premium neural voices (the same ones as
// luvvoice/Edge, e.g. en-US-JennyNeural) — hundreds of them, no download, high quality. The user
// brings their own free Azure Speech key + region; generation is online, but the resulting WAV is
// baked into the Ableton project so playback stays offline. Free tier is 500k chars/month.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Lang } from "@ablejam/shared";

export interface AzureVoice {
  id: string;        // ShortName used in SSML, e.g. "en-US-JennyNeural"
  lang: Lang;        // one of our 4 UI languages
  locale: string;    // full locale, e.g. "en-US" (needed for the SSML xml:lang)
  gender: "M" | "F";
  label: string;     // friendly name for the picker
}

/** Map an Azure locale ("en-US") to one of our 4 UI languages, or null to skip (keeps the picker sane). */
function toLang(locale: string): Lang | null {
  const l = locale.slice(0, 2).toLowerCase();
  return (l === "it" || l === "en" || l === "es" || l === "fr") ? (l as Lang) : null;
}

/** Fetch the region's voice catalog. Throws on auth/other errors so the caller can report them. */
export async function fetchAzureVoices(key: string, region: string): Promise<AzureVoice[]> {
  if (!key || !region) return [];
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
    headers: { "Ocp-Apim-Subscription-Key": key, "User-Agent": "AbleJam" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const arr = (await res.json()) as Array<Record<string, unknown>>;
  const out: AzureVoice[] = [];
  for (const v of Array.isArray(arr) ? arr : []) {
    const locale = String(v.Locale ?? "");
    const lang = toLang(locale);
    if (!lang) continue;
    out.push({
      id: String(v.ShortName ?? ""),
      lang,
      locale,
      gender: String(v.Gender ?? "").toLowerCase() === "male" ? "M" : "F",
      label: String(v.LocalName ?? v.DisplayName ?? v.ShortName ?? ""),
    });
  }
  return out;
}

export interface AzureSynthOpts { rate?: number; pitch?: number } // rate = speed multiplier; pitch = semitones

function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Synthesize `text` with an Azure voice to a WAV at `outPath`. rate (0.5..2, 1 = normal) and pitch
 * (semitones) map to SSML prosody. Output is 24 kHz mono 16-bit PCM WAV (clean for Ableton clips). */
export async function azureSynthesize(
  key: string, region: string, voice: string, locale: string,
  text: string, opts: AzureSynthOpts, outPath: string,
): Promise<boolean> {
  if (!key || !region || !voice) return false;
  const ratePct = Math.round(((opts.rate && opts.rate > 0 ? opts.rate : 1) - 1) * 100); // 1.2 -> +20%
  const pitchSt = Math.round(opts.pitch ?? 0);
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${locale || "en-US"}'>` +
    `<voice name='${voice}'>` +
    `<prosody rate='${ratePct >= 0 ? "+" : ""}${ratePct}%' pitch='${pitchSt >= 0 ? "+" : ""}${pitchSt}st'>${xmlEsc(text)}</prosody>` +
    `</voice></speak>`;
  let res: Response;
  try {
    res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
        "User-Agent": "AbleJam",
      },
      body: ssml,
    });
  } catch {
    return false;
  }
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 64) return false;
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
  return true;
}
