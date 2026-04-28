import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const iconsDir = resolve(root, "public/icons");
const svgPath = resolve(iconsDir, "studyos.svg");
const svg = readFileSync(svgPath);

const standardSizes = [120, 152, 167, 180, 192, 256, 384, 512];
const maskableSizes = [192, 512];
const safePadding = 0.1;
const bgColor = { r: 17, g: 19, b: 30, alpha: 1 };

const renderStandard = async (size) => {
  const buffer = await sharp(svg, { density: Math.max(384, size * 4) })
    .resize(size, size, { fit: "contain", background: bgColor })
    .png()
    .toBuffer();
  const out = resolve(iconsDir, `studyos-${size}.png`);
  writeFileSync(out, buffer);
  console.log(`  wrote studyos-${size}.png`);
};

const renderMaskable = async (size) => {
  const inner = Math.round(size * (1 - safePadding * 2));
  const innerPng = await sharp(svg, { density: Math.max(384, inner * 4) })
    .resize(inner, inner, { fit: "contain", background: bgColor })
    .png()
    .toBuffer();
  const buffer = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: bgColor
    }
  })
    .composite([{ input: innerPng, gravity: "center" }])
    .png()
    .toBuffer();
  const out = resolve(iconsDir, `studyos-maskable-${size}.png`);
  writeFileSync(out, buffer);
  console.log(`  wrote studyos-maskable-${size}.png`);
};

const renderApple = async (size) => {
  const inner = Math.round(size * 0.84);
  const innerPng = await sharp(svg, { density: Math.max(384, inner * 4) })
    .resize(inner, inner, { fit: "contain", background: bgColor })
    .png()
    .toBuffer();
  const buffer = await sharp({
    create: { width: size, height: size, channels: 4, background: bgColor }
  })
    .composite([{ input: innerPng, gravity: "center" }])
    .png()
    .toBuffer();
  const out = resolve(iconsDir, `apple-touch-icon-${size}.png`);
  writeFileSync(out, buffer);
  console.log(`  wrote apple-touch-icon-${size}.png`);
};

console.log("Generating PWA icons from studyos.svg");
for (const size of standardSizes) await renderStandard(size);
for (const size of maskableSizes) await renderMaskable(size);
for (const size of [120, 152, 167, 180]) await renderApple(size);

const favicon = await sharp(svg, { density: 256 })
  .resize(64, 64, { fit: "contain", background: bgColor })
  .png()
  .toBuffer();
writeFileSync(resolve(iconsDir, "favicon-64.png"), favicon);
console.log("  wrote favicon-64.png");

console.log("Done.");
