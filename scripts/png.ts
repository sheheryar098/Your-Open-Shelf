import { deflateSync, crc32 } from "node:zlib";

/** Minimal PNG encoder used to generate placeholder "actual copy" photos for demo data. */
export function placeholderPng(width: number, height: number, hue: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const [r1, g1, b1] = hsl(hue, 0.45, 0.42);
  const [r2, g2, b2] = hsl((hue + 30) % 360, 0.5, 0.62);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const t = (x + y) / (width + height);
      const spine = x < width * 0.08 ? 0.75 : 1;
      const i = row + 1 + x * 3;
      raw[i] = Math.round((r1 + (r2 - r1) * t) * spine);
      raw[i + 1] = Math.round((g1 + (g2 - g1) * t) * spine);
      raw[i + 2] = Math.round((b1 + (b2 - b1) * t) * spine);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
