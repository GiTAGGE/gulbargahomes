import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "public", "images", "source");
const PROP_ROOT = path.join(ROOT, "public", "images", "properties");
const VIDEO_ROOT = path.join(ROOT, "public", "videos", "properties");
const HERO_DIR = path.join(ROOT, "public", "images", "hero");
const CONTENT_DIR = path.join(ROOT, "content", "properties");

const SETS = {
  Flat: ["prop-apartment-exterior.webp", "prop-living-2bhk.webp", "prop-kitchen.webp"],
  House: ["prop-house-exterior.webp", "prop-living-3bhk.webp", "prop-bedroom.webp"],
  Villa: ["prop-villa-exterior.webp", "prop-living-3bhk.webp", "prop-kitchen.webp"],
  Plot: ["prop-plot-land.webp", "prop-plot-layout.webp", "prop-house-exterior.webp"],
  PG: ["prop-1bhk-room.webp", "prop-kitchen.webp", "prop-apartment-exterior.webp"],
  Commercial: ["prop-apartment-exterior.webp", "prop-kitchen.webp", "prop-living-2bhk.webp"],
};

const ORIGINAL_EXT = /\.(webp|jpe?g|png)$/i;

function hash(value) {
  let total = 0;
  for (const char of value) total += char.charCodeAt(0);
  return total;
}

async function writeHero() {
  fs.mkdirSync(HERO_DIR, { recursive: true });
  const sceneSrc = path.join(SOURCE, "gulbarga-hero-scene.webp");
  const desktopSrc = fs.existsSync(sceneSrc)
    ? sceneSrc
    : path.join(SOURCE, "gulbarga-hero-desktop.webp");

  await sharp(desktopSrc)
    .rotate()
    .resize({ width: 1920, withoutEnlargement: false })
    .webp({ quality: 86 })
    .toFile(path.join(HERO_DIR, "hero-desktop.webp"));

  await sharp(desktopSrc)
    .rotate()
    .resize(1080, 1350, { fit: "cover", position: "left" })
    .webp({ quality: 80 })
    .toFile(path.join(HERO_DIR, "hero-mobile.webp"));

  await sharp(path.join(HERO_DIR, "hero-desktop.webp"))
    .resize(32, 12, { fit: "cover" })
    .webp({ quality: 32 })
    .toFile(path.join(HERO_DIR, "hero-blur.webp"));

  const blur = await sharp(path.join(HERO_DIR, "hero-blur.webp")).toBuffer();
  const dataUrl = `data:image/webp;base64,${blur.toString("base64")}`;
  fs.writeFileSync(
    path.join(ROOT, "lib", "hero-blur.ts"),
    `export const heroBlurDataUrl = ${JSON.stringify(dataUrl)};\n`,
  );
}

async function writeOriginal(inputPath, outputPath) {
  await sharp(inputPath)
    .rotate()
    .resize(1600, 1200, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outputPath);
}

function listingOriginals(slug) {
  const dir = path.join(SOURCE, "properties", slug);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((file) => ORIGINAL_EXT.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((file) => path.join(dir, file));
}

async function makeVariant(inputPath, outputPath, index, salt) {
  const image = sharp(inputPath).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 1600;
  const height = meta.height ?? 1200;
  const trimX = Math.min(Math.floor(width * 0.08), 80);
  const trimY = Math.min(Math.floor(height * 0.08), 60);
  const offsetX = ((salt + index * 17) % Math.max(trimX, 1));
  const offsetY = ((salt + index * 29) % Math.max(trimY, 1));

  await image
    .extract({
      left: offsetX,
      top: offsetY,
      width: width - trimX,
      height: height - trimY,
    })
    .resize(1200, 800, { fit: "cover", position: index === 0 ? "centre" : "attention" })
    .webp({ quality: 74 })
    .toFile(outputPath);
}

function makeVideo(slug, dir) {
  const files = ["cover.webp", "1.webp", "2.webp"]
    .map((name) => path.join(dir, name))
    .filter((file) => fs.existsSync(file));
  if (files.length === 0) return;
  while (files.length < 3) files.push(files[files.length - 1]);

  const output = path.join(VIDEO_ROOT, `${slug}.mp4`);
  const filters = files
    .map(
      (_, index) =>
        `[${index}:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,fps=25,format=yuv420p[v${index}]`,
    )
    .join(";");
  const concatInputs = files.map((_, index) => `[v${index}]`).join("");
  const args = [
    "-y",
    ...files.flatMap((file) => ["-loop", "1", "-t", "2", "-i", file]),
    "-filter_complex",
    `${filters};${concatInputs}concat=n=3:v=1:a=0[out]`,
    "-map",
    "[out]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-crf",
    "30",
    "-preset",
    "veryfast",
    output,
  ];

  execFileSync("ffmpeg", args, { stdio: "pipe" });
}

async function main() {
  await writeHero();
  fs.mkdirSync(PROP_ROOT, { recursive: true });
  fs.mkdirSync(VIDEO_ROOT, { recursive: true });

  const files = fs.readdirSync(CONTENT_DIR).filter((file) => file.endsWith(".mdx"));
  const blurMap = {};

  for (const file of files) {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8");
    const slug = raw.match(/^slug:\s*(.+)$/m)?.[1]?.trim();
    const type = raw.match(/^propertyType:\s*(.+)$/m)?.[1]?.trim() ?? "House";
    const wantsVideo = /src:\s*\/videos\/properties\//.test(raw);
    if (!slug) continue;

    const originals = listingOriginals(slug);
    const dir = path.join(PROP_ROOT, slug);
    fs.mkdirSync(dir, { recursive: true });

    if (originals.length > 0) {
      await sharp(originals[0])
        .rotate()
        .resize(1600, 1067, { fit: "cover", position: "centre" })
        .webp({ quality: 82 })
        .toFile(path.join(dir, "cover.webp"));

      for (let i = 0; i < originals.length; i++) {
        await writeOriginal(originals[i], path.join(dir, `${i + 1}.webp`));
      }
    } else {
      const sources = SETS[type] ?? SETS.House;
      const salt = hash(slug);
      const names = ["cover.webp", "1.webp", "2.webp"];

      for (let i = 0; i < names.length; i++) {
        const sourceName = sources[i % sources.length];
        await makeVariant(
          path.join(SOURCE, sourceName),
          path.join(dir, names[i]),
          i,
          salt,
        );
      }
    }

    const blur = await sharp(path.join(dir, "cover.webp"))
      .resize(16, 10, { fit: "cover" })
      .webp({ quality: 40 })
      .toBuffer();
    blurMap[slug] = `data:image/webp;base64,${blur.toString("base64")}`;

    if (wantsVideo) {
      makeVideo(slug, dir);
    }
  }

  fs.writeFileSync(
    path.join(ROOT, "lib", "image-blur.json"),
    JSON.stringify(blurMap, null, 2),
  );
  console.log(`Generated media for ${Object.keys(blurMap).length} properties.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
