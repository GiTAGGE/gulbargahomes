import fs from "node:fs";
import path from "node:path";

const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim() ?? "";
const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY?.trim() ?? "";
const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET?.trim() ?? "";

const outPath = path.join(process.cwd(), "public", "admin", "cloudinary-config.js");

if (!cloudName || !apiKey || !uploadPreset) {
  fs.writeFileSync(
    outPath,
    "// Cloudinary admin uploads disabled — set NEXT_PUBLIC_CLOUDINARY_* in Netlify env.\n",
  );
  process.exit(0);
}

const payload = {
  cloud_name: cloudName,
  api_key: apiKey,
  multiple: true,
  upload_preset: uploadPreset,
};

fs.writeFileSync(
  outPath,
  `window.__GULBARGA_CLOUDINARY_CONFIG = ${JSON.stringify(payload)};\n`,
);
