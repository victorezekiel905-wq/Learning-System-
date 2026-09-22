// Generates extension/icons/icon{32,128}.png (brand gradient tile with an "S" ring)
// using only Node built-ins. Run: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const r = size * 0.44, rIn = size * 0.26, c = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      // #4f46e5 → #0891b2 diagonal gradient
      let R = Math.round(0x4f + (0x08 - 0x4f) * t), G = Math.round(0x46 + (0x91 - 0x46) * t), B = Math.round(0xe5 + (0xb2 - 0xe5) * t), A = 255;
      // rounded corners
      const cr = size * 0.22, dx = Math.max(cr - x, x - (size - 1 - cr), 0), dy = Math.max(cr - y, y - (size - 1 - cr), 0);
      if (Math.hypot(dx, dy) > cr) A = 0;
      // white ring with a gap (stylised S/cipher dial)
      const d = Math.hypot(x - c, y - c), ang = Math.atan2(y - c, x - c);
      if (d < r && d > rIn && !(ang > -0.5 && ang < 0.9)) { R = G = B = 255; }
      if (d < size * 0.09) { R = G = B = 255; }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = R; raw[o + 1] = G; raw[o + 2] = B; raw[o + 3] = A;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("extension/icons", { recursive: true });
for (const s of [32, 128]) writeFileSync(`extension/icons/icon${s}.png`, png(s));
console.log("icons written");
