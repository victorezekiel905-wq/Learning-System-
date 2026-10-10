// Draws the installable-app icons (Add to Home Screen) from the SwiftCipher mark.
//   node scripts/make-app-icons.mjs   → public/app-icon-{192,512}.png, app-icon-maskable-512.png, apple-touch-icon.png
import sharp from "sharp";

// The mark from src/components/Logo.tsx: ink tile, white "S", lime notch.
const mark = (size, pad) => {
  const s = 40 + pad * 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${s} ${s}" width="${size}" height="${size}">
  ${pad ? `<rect x="${-pad}" y="${-pad}" width="${s}" height="${s}" fill="#151411"/>` : ""}
  <rect width="40" height="40" rx="10" fill="#151411"/>
  <path d="M26.5 13.2c-1.7-1.6-4-2.4-6.6-2.4-4.2 0-7 2.2-7 5.3 0 7.3 14.6 3.6 14.6 10.6 0 3.2-3 5.5-7.4 5.5-2.9 0-5.4-1-7.2-2.8" fill="none" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round"/>
  <rect x="29" y="4" width="7" height="7" rx="2" fill="#C8F03C"/>
</svg>`);
};

const out = [
  ["public/app-icon-192.png", 192, 0],
  ["public/app-icon-512.png", 512, 0],
  // Android crops "maskable" icons to a circle or squircle: keep the mark inside the safe zone.
  ["public/app-icon-maskable-512.png", 512, 8],
  ["public/apple-touch-icon.png", 180, 0]
];
for (const [file, size, pad] of out) {
  await sharp(mark(size, pad)).png().toFile(file);
  console.log("wrote", file);
}
