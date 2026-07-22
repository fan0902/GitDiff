import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const sourcePath = process.argv[2];
if (!sourcePath) {
  throw new Error("请传入包含 BR 图标的截图路径");
}

const outputDir = fileURLToPath(new URL("./", import.meta.url));
const masterPath = join(outputDir, "GitDiff-icon-preview.png");
const icnsPath = join(outputDir, "GitDiff.icns");
const workDir = await mkdtemp(join(tmpdir(), "gitdiff-iconset-"));
const iconsetPath = join(workDir, "GitDiff.iconset");
await mkdir(iconsetPath);

// Screenshot coordinates for the 76×76 BR mark. A matching rounded mask keeps
// the enclosed white BR letters intact and removes the surrounding page color.
const croppedMark = await sharp(sourcePath)
  .extract({ left: 32, top: 21, width: 76, height: 76 })
  .png()
  .toBuffer();
const roundedMask = Buffer.from(
  '<svg width="76" height="76" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="72" height="72" rx="18" fill="white"/></svg>',
);
const clippedMark = await sharp(croppedMark)
  .composite([{ input: roundedMask, blend: "dest-in" }])
  .png()
  .toBuffer();

const mark = await sharp(clippedMark)
  .resize(800, 800, { kernel: sharp.kernel.lanczos3 })
  .png()
  .toBuffer();

await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: mark, left: 112, top: 112 }])
  .png()
  .toFile(masterPath);

const sizes = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

try {
  for (const [name, size] of sizes) {
    await sharp(masterPath).resize(size, size).png().toFile(join(iconsetPath, name));
  }
  execFileSync("/usr/bin/iconutil", ["-c", "icns", iconsetPath, "-o", icnsPath]);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

console.log(`图标预览：${masterPath}`);
console.log(`应用图标：${icnsPath}`);
