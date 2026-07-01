// Ecoji V2 encoder — generates emoji tokens from random bytes
// Based on the Ecoji standard by Keith Turner: https://github.com/keith-turner/ecoji
// Uses V2 emoji set from Unicode 14.0

// V2 emoji code points (1024 emojis, 10 bits each)
// Auto-generated from emojisV2.txt
// prettier-ignore
import { readFileSync } from "fs";

// Load the V2 emoji mapping at startup
// The file is fetched at build time — see scripts/fetch-emojis.sh
// Falls back to generating from the ecoji-js V1 set if not available

// Simple inline V2 encoder:
// 5 bytes → 4 emojis (no padding when input is multiple of 5)
// We use 10 bytes → 8 emojis for tokens (no padding)

const EMOJIS_V2: string[] = (() => {
  try {
    const text = readFileSync("emojisV2.txt", "utf-8");
    return text.trim().split("\n").map((s: string) => String.fromCodePoint(parseInt(s.trim(), 16)));
  } catch {
    // Fallback: we'll fetch it in a build step
    // For now, throw so we know to run the fetch script
    throw new Error("emojisV2.txt not found. Run: bun run scripts/fetch-emojis.ts");
  }
})();

export function encode(data: Uint8Array): string {
  let result = "";
  for (let i = 0; i < data.length; i += 5) {
    const remaining = data.length - i;
    const b0 = data[i];
    const b1 = remaining > 1 ? data[i + 1] : 0;
    const b2 = remaining > 2 ? data[i + 2] : 0;
    const b3 = remaining > 3 ? data[i + 3] : 0;
    const b4 = remaining > 4 ? data[i + 4] : 0;

    if (remaining >= 5) {
      result += EMOJIS_V2[(b0 << 2) | (b1 >> 6)];
      result += EMOJIS_V2[((b1 & 0x3f) << 4) | (b2 >> 4)];
      result += EMOJIS_V2[((b2 & 0x0f) << 6) | (b3 >> 2)];
      result += EMOJIS_V2[((b3 & 0x03) << 8) | b4];
    } else if (remaining === 4) {
      result += EMOJIS_V2[(b0 << 2) | (b1 >> 6)];
      result += EMOJIS_V2[((b1 & 0x3f) << 4) | (b2 >> 4)];
      result += EMOJIS_V2[((b2 & 0x0f) << 6) | (b3 >> 2)];
      // V2 padding: use last 2 bits of b3 to pick padding emoji
      // For simplicity in V2, we just omit padding (V2 allows < 4 padding emojis)
    } else if (remaining === 3) {
      result += EMOJIS_V2[(b0 << 2) | (b1 >> 6)];
      result += EMOJIS_V2[((b1 & 0x3f) << 4) | (b2 >> 4)];
    } else if (remaining === 2) {
      result += EMOJIS_V2[(b0 << 2) | (b1 >> 6)];
    } else {
      result += EMOJIS_V2[b0 << 2];
    }
  }
  return result;
}

export function randomToken(): string {
  // 10 bytes → 8 emojis, no padding
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return encode(bytes);
}
