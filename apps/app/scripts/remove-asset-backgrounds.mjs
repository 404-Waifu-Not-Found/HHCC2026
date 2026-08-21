import { readdir, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const background = [244, 244, 244];
const tolerance = 3;

function colorDelta(data, offset) {
  return Math.max(
    Math.abs(data[offset] - background[0]),
    Math.abs(data[offset + 1] - background[1]),
    Math.abs(data[offset + 2] - background[2]),
  );
}

function expandMask(mask, width, height) {
  const expanded = mask.slice();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index]) continue;
      if (
        (x > 0 && mask[index - 1]) ||
        (x + 1 < width && mask[index + 1]) ||
        (y > 0 && mask[index - width]) ||
        (y + 1 < height && mask[index + width])
      ) {
        expanded[index] = 1;
      }
    }
  }
  return expanded;
}

async function removeBorderBackground(path) {
  const image = sharp(path);
  const metadata = await image.metadata();
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const cornerIndices = [
    0,
    width - 1,
    (height - 1) * width,
    width * height - 1,
  ];

  if (
    metadata.hasAlpha &&
    cornerIndices.every((index) => data[index * channels + 3] === 0)
  ) {
    return { path, changed: false };
  }

  const pixelCount = width * height;
  const deltas = new Uint8Array(pixelCount);
  const backgroundMask = new Uint8Array(pixelCount);
  const queued = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    deltas[index] = colorDelta(data, index * channels);
  }

  const enqueue = (index) => {
    if (queued[index] || deltas[index] > tolerance) return;
    queued[index] = 1;
    queue[queueEnd] = index;
    queueEnd += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y + 1 < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (queueStart < queueEnd) {
    const index = queue[queueStart];
    queueStart += 1;
    backgroundMask[index] = 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  const firstRing = expandMask(backgroundMask, width, height);
  const featherRegion = expandMask(firstRing, width, height);
  const output = Buffer.alloc(pixelCount * 4);
  let visiblePixels = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    const outputOffset = index * 4;
    const inputOffset = index * channels;
    if (backgroundMask[index]) {
      output.fill(0, outputOffset, outputOffset + 4);
      continue;
    }

    let alpha = 255;
    if (featherRegion[index]) {
      const x = index % width;
      const y = Math.floor(index / width);
      let foregroundOffset = inputOffset;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let yOffset = -4; yOffset <= 4; yOffset += 1) {
        const sampleY = y + yOffset;
        if (sampleY < 0 || sampleY >= height) continue;
        for (let xOffset = -4; xOffset <= 4; xOffset += 1) {
          const sampleX = x + xOffset;
          if (sampleX < 0 || sampleX >= width) continue;
          const sampleIndex = sampleY * width + sampleX;
          if (backgroundMask[sampleIndex] || featherRegion[sampleIndex]) {
            continue;
          }
          const distance = xOffset * xOffset + yOffset * yOffset;
          if (distance < nearestDistance) {
            nearestDistance = distance;
            foregroundOffset = sampleIndex * channels;
          }
        }
      }

      const foregroundVector = [0, 1, 2].map(
        (channel) => data[foregroundOffset + channel] - background[channel],
      );
      const observedVector = [0, 1, 2].map(
        (channel) => data[inputOffset + channel] - background[channel],
      );
      const denominator = foregroundVector.reduce(
        (sum, value) => sum + value * value,
        0,
      );
      const projectedAlpha =
        denominator < 64
          ? 1
          : observedVector.reduce(
              (sum, value, channel) => sum + value * foregroundVector[channel],
              0,
            ) / denominator;
      alpha = Math.round(Math.max(0, Math.min(1, projectedAlpha)) * 255);

      if (alpha > 0 && alpha < 255) {
        const normalizedAlpha = alpha / 255;
        for (let channel = 0; channel < 3; channel += 1) {
          output[outputOffset + channel] = Math.max(
            0,
            Math.min(
              255,
              Math.round(
                (data[inputOffset + channel] -
                  (1 - normalizedAlpha) * background[channel]) /
                  normalizedAlpha,
              ),
            ),
          );
        }
      }
    }

    if (alpha > 0) visiblePixels += 1;
    if (alpha === 255) {
      output[outputOffset] = data[inputOffset];
      output[outputOffset + 1] = data[inputOffset + 1];
      output[outputOffset + 2] = data[inputOffset + 2];
    }
    output[outputOffset + 3] = alpha;
  }

  if (visiblePixels === 0) {
    throw new Error(`Background removal erased the complete subject: ${path}`);
  }

  const temporaryPath = `${path}.transparent.png`;
  await sharp(output, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(temporaryPath);
  await rename(temporaryPath, path);

  return { path, changed: true, visiblePixels };
}

const iconRoot = resolve(appRoot, "assets/icons/voxel");
const iconFiles = (await readdir(iconRoot))
  .filter((name) => name.endsWith(".png"))
  .map((name) => resolve(iconRoot, name));
const canonicalAssets = [
  resolve(appRoot, "assets/brand/learning-prism.png"),
  ...iconFiles,
];

const results = [];
for (const path of canonicalAssets) {
  results.push(await removeBorderBackground(path));
}

console.log(
  `Transparent canonical assets ready: ${results.filter((result) => result.changed).length} converted, ${results.filter((result) => !result.changed).length} already transparent.`,
);
