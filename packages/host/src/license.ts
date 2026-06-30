// AbleJam license verification — OFFLINE, Ed25519 signature. Perfect for a stage app: a key
// is verified locally with no internet (the show must go on even with no WiFi), and it is
// unforgeable without the PRIVATE key, which lives ONLY on the ablejam.com server (a Vercel
// secret). This file holds the matching PUBLIC key — safe to ship in the client.
//
// Key format (what the customer pastes): base64url(payloadJSON) + "." + base64url(signature).
// The website (ablejam.com) signs the payload after a purchase and emails the resulting token.
import crypto from "node:crypto";

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAwHh4nd/73dcg14yDdqpl/4vTaa3HY0fWGmVCoSGVjkA=
-----END PUBLIC KEY-----`;

export interface LicensePayload {
  v: number; // schema version
  email: string; // buyer email — the license is tied to it
  name?: string; // buyer name (optional, for display)
  plan: string; // "full"
  iat: number; // issued-at, unix seconds
  oid?: string; // order / payment id (optional)
}

/** Verify a pasted license key. Returns the payload when the signature is valid AND it is a
 * full-version key, otherwise null. Tolerant of surrounding whitespace/newlines from email. */
export function verifyLicenseKey(key: string): LicensePayload | null {
  try {
    const clean = (key ?? "").trim().replace(/\s+/g, "");
    const dot = clean.indexOf(".");
    if (dot <= 0 || dot >= clean.length - 1) return null;
    const payloadBuf = Buffer.from(clean.slice(0, dot), "base64url");
    const sig = Buffer.from(clean.slice(dot + 1), "base64url");
    if (sig.length === 0 || payloadBuf.length === 0) return null;
    if (!crypto.verify(null, payloadBuf, PUBLIC_KEY, sig)) return null; // Ed25519 -> null digest
    const payload = JSON.parse(payloadBuf.toString("utf8")) as LicensePayload;
    if (!payload || typeof payload.email !== "string" || payload.plan !== "full") return null;
    return payload;
  } catch {
    return null;
  }
}

/** True when `key` is a valid AbleJam full license. */
export function isLicensed(key: string | undefined | null): boolean {
  return verifyLicenseKey(String(key ?? "")) != null;
}

// ---- Device activation (3-device limit) -------------------------------------------------------
// After the online activation handshake the app stores an ACTIVATION TOKEN (signed by the same
// keypair) that binds the key to THIS device. From then on the app verifies it OFFLINE — no internet
// needed — and unlocks Pro only when the token's key-hash + device-id both match.

export interface ActivationPayload {
  v: number;
  typ: "activation";
  kid: string; // key id (hash) the token is bound to
  did: string; // device id (hash) the token is bound to
  email: string;
  iat: number;
}

/** Stable short id for a license key (must match the server's keyId()). */
export function keyId(key: string): string {
  const clean = (key ?? "").trim().replace(/\s+/g, "");
  return crypto.createHash("sha256").update(clean).digest("hex").slice(0, 32);
}

/** Verify an activation token's signature offline. Returns the payload, or null if invalid. The
 * caller still checks `kid` matches the stored key and `did` matches this machine. */
export function verifyActivationToken(token: string): ActivationPayload | null {
  try {
    const clean = (token ?? "").trim().replace(/\s+/g, "");
    const dot = clean.indexOf(".");
    if (dot <= 0 || dot >= clean.length - 1) return null;
    const payloadBuf = Buffer.from(clean.slice(0, dot), "base64url");
    const sig = Buffer.from(clean.slice(dot + 1), "base64url");
    if (!sig.length || !payloadBuf.length) return null;
    if (!crypto.verify(null, payloadBuf, PUBLIC_KEY, sig)) return null;
    const p = JSON.parse(payloadBuf.toString("utf8")) as ActivationPayload;
    if (!p || p.typ !== "activation" || typeof p.kid !== "string" || typeof p.did !== "string") return null;
    return p;
  } catch {
    return null;
  }
}

/** Full offline check: the stored key is valid AND the activation token binds THIS device to it. */
export function isActivatedHere(key: string, token: string, did: string): boolean {
  if (!isLicensed(key)) return false;
  const p = verifyActivationToken(token);
  return !!p && p.kid === keyId(key) && p.did === did;
}
