/**
 * Renders the app icons from scripts/icons/icon.svg (npm run icons). Run it after changing the SVG
 * and commit the results:
 * - public/icons/: the installed app's icons, listed in src/app/manifest.ts (plain and maskable)
 * - src/app/icon.svg, apple-icon.png, favicon.ico: the browser tab and iPhone home-screen icons
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync("scripts/icons/icon.svg", "utf8");
/** The plain icon has rounded corners; the maskable one keeps the full square for Android to crop. */
const rounded = svg.replace('<rect width="512" height="512"', '<rect width="512" height="512" rx="112"');

function png(source: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(source), { density: (72 * size) / 512 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** An .ico holding one PNG image (every current browser reads PNG inside .ico). */
function ico(image: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(size, 6); // width
  header.writeUInt8(size, 7); // height
  header.writeUInt8(0, 8); // no palette
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(image.length, 14); // image size
  header.writeUInt32LE(header.length, 18); // image offset
  return Buffer.concat([header, image]);
}

async function main() {
  mkdirSync("public/icons", { recursive: true });
  writeFileSync("public/icons/icon-192.png", await png(rounded, 192));
  writeFileSync("public/icons/icon-512.png", await png(rounded, 512));
  writeFileSync("public/icons/maskable-192.png", await png(svg, 192));
  writeFileSync("public/icons/maskable-512.png", await png(svg, 512));
  // iPhones round the corners themselves and show transparency as black, so the full square.
  writeFileSync("src/app/apple-icon.png", await png(svg, 180));
  writeFileSync("src/app/icon.svg", rounded.replace(/\s*<!--[\s\S]*?-->/, ""));
  writeFileSync("src/app/favicon.ico", ico(await png(rounded, 32), 32));
  console.log("Icons written.");
}

main();
