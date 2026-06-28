// Minimal OSC 1.0 codec (host-side, Node Buffer).
// Supports the types AbleJam needs: int32 'i', float32 'f', string 's'.
// Mirrors bridge/AbleJam/osc.py so both ends speak the same wire format.

export type OscType = "i" | "f" | "s";
export interface OscArg {
  type: OscType;
  value: number | string;
}
export interface OscMessage {
  address: string;
  args: (number | string)[];
}

function oscString(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const totalUnpadded = b.length + 1; // at least one null terminator
  const pad = (4 - (totalUnpadded % 4)) % 4;
  return Buffer.concat([b, Buffer.alloc(1 + pad)]);
}

/**
 * Encode an OSC message. Plain numbers are inferred as int32 when integer,
 * float32 otherwise; pass an OscArg to force the type.
 */
export function encode(address: string, args: (number | string | OscArg)[] = []): Buffer {
  let types = ",";
  const parts: Buffer[] = [];
  for (const a of args) {
    let t: OscType;
    let v: number | string;
    if (typeof a === "object") {
      t = a.type;
      v = a.value;
    } else if (typeof a === "string") {
      t = "s";
      v = a;
    } else if (Number.isInteger(a)) {
      t = "i";
      v = a;
    } else {
      t = "f";
      v = a;
    }
    types += t;
    if (t === "i") {
      const b = Buffer.alloc(4);
      b.writeInt32BE(v as number);
      parts.push(b);
    } else if (t === "f") {
      const b = Buffer.alloc(4);
      b.writeFloatBE(v as number);
      parts.push(b);
    } else {
      parts.push(oscString(String(v)));
    }
  }
  return Buffer.concat([oscString(address), oscString(types), ...parts]);
}

function readString(buf: Buffer, offset: number): [string, number] {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const s = buf.toString("utf8", offset, end);
  let next = end + 1;
  next += (4 - (next % 4)) % 4;
  return [s, next];
}

export function decode(buf: Buffer): OscMessage {
  let o = 0;
  const [address, afterAddr] = readString(buf, 0);
  o = afterAddr;
  const args: (number | string)[] = [];
  if (o < buf.length && buf[o] === 0x2c /* ',' */) {
    const [types, afterTypes] = readString(buf, o);
    o = afterTypes;
    for (const t of types.slice(1)) {
      if (t === "i") {
        args.push(buf.readInt32BE(o));
        o += 4;
      } else if (t === "f") {
        args.push(buf.readFloatBE(o));
        o += 4;
      } else if (t === "s") {
        const [s, next] = readString(buf, o);
        args.push(s);
        o = next;
      }
    }
  }
  return { address, args };
}
