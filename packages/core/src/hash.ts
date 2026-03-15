/**
 * @module hash
 *
 * Hashing utilities for the Softlaunch evaluation engine.
 *
 * Two hash functions serve distinct purposes:
 *
 * 1. `md5` — Used for config obfuscation (flag keys, attribute names, equality values).
 *    Must produce identical output across all SDK languages. Uses the standard
 *    MD5 algorithm (RFC 1321) with lowercase hex output.
 *
 * 2. `computeBucket` — Used for percentage rollout bucketing. Takes a salt and
 *    a value, produces a deterministic integer in [0, totalShards).
 *    Uses MurmurHash3-32 for speed and uniform distribution.
 *
 * Both implementations are pure TypeScript with zero dependencies,
 * designed to run identically in Node.js, browsers, and edge runtimes.
 */

// ---------------------------------------------------------------------------
// MD5 (RFC 1321) — for obfuscation
// ---------------------------------------------------------------------------

/**
 * Compute the MD5 hash of a UTF-8 string, returned as a 32-character lowercase hex string.
 *
 * This is used for obfuscating flag keys, attribute names, operator names,
 * and equality comparison values in client-format config blobs.
 */
export function md5(input: string): string {
  const bytes = encodeUtf8(input);
  const padded = padMessage(bytes);
  const words = bytesToWords(padded);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let i = 0; i < words.length; i += 16) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let j = 0; j < 64; j++) {
      let f: number;
      let g: number;

      if (j < 16) {
        f = (b & c) | (~b & d);
        g = j;
      } else if (j < 32) {
        f = (d & b) | (~d & c);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        f = b ^ c ^ d;
        g = (3 * j + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * j) % 16;
      }

      const temp = d;
      d = c;
      c = b;
      const wordAtG = words[i + g];
      if (wordAtG === undefined) {
        throw new Error(`MD5 internal error: missing word at index ${i + g}`);
      }
      const sum = (a + f + MD5_K[j]! + wordAtG) | 0;
      b = (b + rotateLeft(sum, MD5_S[j]!)) | 0;
      a = temp;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  return wordsToHex(a0, b0, c0, d0);
}

// ---------------------------------------------------------------------------
// MurmurHash3-32 — for rollout bucketing
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic bucket assignment for percentage rollouts.
 *
 * @param salt   - Unique salt for this rollout (e.g., `${flagKey}-${ruleId}`)
 * @param value  - The context value to bucket (typically context.key)
 * @param totalShards - Total number of shards (default 10_000)
 * @returns Integer in [0, totalShards)
 */
export function computeBucket(salt: string, value: string, totalShards: number): number {
  const hashInput = `${salt}.${value}`;
  const hash = murmurHash3(hashInput, 0);
  // Unsigned modulo: MurmurHash3 returns a 32-bit value, use unsigned right shift
  return (hash >>> 0) % totalShards;
}

/**
 * MurmurHash3 x86 32-bit implementation.
 * Produces a 32-bit hash from a UTF-8 string and a seed.
 */
function murmurHash3(input: string, seed: number): number {
  const bytes = encodeUtf8(input);
  const length = bytes.length;
  const blockCount = Math.floor(length / 4);

  let h1 = seed;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  // Process 4-byte blocks
  for (let i = 0; i < blockCount; i++) {
    const offset = i * 4;
    let k1 = bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24);

    k1 = Math.imul(k1, c1);
    k1 = rotateLeft(k1, 15);
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = rotateLeft(h1, 13);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
  }

  // Process remaining bytes
  const tailOffset = blockCount * 4;
  let k1 = 0;

  switch (length & 3) {
    case 3:
      k1 ^= bytes[tailOffset + 2]! << 16;
    // fallthrough
    case 2:
      k1 ^= bytes[tailOffset + 1]! << 8;
    // fallthrough
    case 1:
      k1 ^= bytes[tailOffset]!;
      k1 = Math.imul(k1, c1);
      k1 = rotateLeft(k1, 15);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
  }

  // Finalization
  h1 ^= length;
  h1 = fmix32(h1);

  return h1;
}

// ---------------------------------------------------------------------------
// Base64 encoding/decoding — for obfuscated config values
// ---------------------------------------------------------------------------

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Encode a UTF-8 string to base64. */
export function base64Encode(input: string): string {
  const bytes = encodeUtf8(input);
  let result = "";
  let i = 0;

  while (i < bytes.length) {
    const b0 = bytes[i++] ?? 0;
    const b1 = i < bytes.length ? bytes[i++]! : -1;
    const b2 = i < bytes.length ? bytes[i++]! : -1;

    result += BASE64_CHARS[(b0 >> 2)!]!;
    result += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 >= 0 ? b1 >> 4 : 0)]!;
    result += b1 >= 0 ? BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 >= 0 ? b2 >> 6 : 0)]! : "=";
    result += b2 >= 0 ? BASE64_CHARS[b2 & 0x3f]! : "=";
  }

  return result;
}

/** Decode a base64 string to a UTF-8 string. */
export function base64Decode(input: string): string {
  const lookup = new Map<string, number>();
  for (let i = 0; i < BASE64_CHARS.length; i++) {
    lookup.set(BASE64_CHARS[i]!, i);
  }

  const clean = input.replace(/=+$/, "");
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup.get(clean[i]!) ?? 0;
    const b = lookup.get(clean[i + 1]!) ?? 0;
    const c = lookup.get(clean[i + 2] ?? "") ?? 0;
    const d = lookup.get(clean[i + 3] ?? "") ?? 0;

    bytes.push((a << 2) | (b >> 4));
    if (i + 2 < clean.length) bytes.push(((b & 0x0f) << 4) | (c >> 2));
    if (i + 3 < clean.length) bytes.push(((c & 0x03) << 6) | d);
  }

  return decodeUtf8(new Uint8Array(bytes));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function encodeUtf8(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        i++;
      }
    }

    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

function decodeUtf8(bytes: Uint8Array): string {
  let result = "";
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i]!;
    let code: number;

    if (byte < 0x80) {
      code = byte;
      i += 1;
    } else if ((byte & 0xe0) === 0xc0) {
      code = ((byte & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
      i += 2;
    } else if ((byte & 0xf0) === 0xe0) {
      code = ((byte & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
      i += 3;
    } else {
      code =
        ((byte & 0x07) << 18) | ((bytes[i + 1]! & 0x3f) << 12) | ((bytes[i + 2]! & 0x3f) << 6) | (bytes[i + 3]! & 0x3f);
      i += 4;
    }

    if (code <= 0xffff) {
      result += String.fromCharCode(code);
    } else {
      code -= 0x10000;
      result += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    }
  }
  return result;
}

function rotateLeft(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift));
}

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h;
}

function padMessage(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;
  // Pad to 56 mod 64 bytes, then append 8 bytes of length
  const paddingNeeded = (56 - ((bytes.length + 1) % 64) + 64) % 64;
  const padded = new Uint8Array(bytes.length + 1 + paddingNeeded + 8);

  padded.set(bytes);
  padded[bytes.length] = 0x80;

  // Append original length in bits as 64-bit little-endian
  const lengthOffset = padded.length - 8;
  padded[lengthOffset] = bitLength & 0xff;
  padded[lengthOffset + 1] = (bitLength >>> 8) & 0xff;
  padded[lengthOffset + 2] = (bitLength >>> 16) & 0xff;
  padded[lengthOffset + 3] = (bitLength >>> 24) & 0xff;
  // High 32 bits are zero for messages < 512 MB

  return padded;
}

function bytesToWords(bytes: Uint8Array): number[] {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24));
  }
  return words;
}

function wordsToHex(a: number, b: number, c: number, d: number): string {
  return wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
}

function wordToHex(word: number): string {
  let hex = "";
  for (let i = 0; i < 4; i++) {
    const byte = (word >>> (i * 8)) & 0xff;
    hex += HEX_CHARS[byte >> 4]! + HEX_CHARS[byte & 0x0f]!;
  }
  return hex;
}

const HEX_CHARS = "0123456789abcdef";

// ---------------------------------------------------------------------------
// MD5 constants — per-round shift amounts and sine-derived constants
// ---------------------------------------------------------------------------

const MD5_S: readonly number[] = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4,
  11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K: readonly number[] = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501, 0x698098d8,
  0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
  0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87,
  0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039,
  0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
  0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
  0xeb86d391,
];
