function decodeBmp(bytes) {
  if (bytes.length < 54 || bytes.toString('ascii', 0, 2) !== 'BM') return null;
  const pixelOffset = bytes.readUInt32LE(10);
  const dibSize = bytes.readUInt32LE(14);
  if (dibSize < 40 || 14 + dibSize > bytes.length) return null;
  const width = bytes.readInt32LE(18);
  const signedHeight = bytes.readInt32LE(22);
  const depth = bytes.readUInt16LE(28);
  const compression = bytes.readUInt32LE(30);
  if (bytes.readUInt16LE(26) !== 1 || width <= 0 || signedHeight === 0 || ![8, 24, 32].includes(depth) || compression !== 0) return null;
  const height = Math.abs(signedHeight);
  if (width > 10000 || height > 10000 || width * height > 25_000_000) return null;
  const rowBytes = Math.floor((width * depth + 31) / 32) * 4;
  if (pixelOffset + rowBytes * height > bytes.length) return null;
  const paletteOffset = 14 + dibSize;
  const paletteSize = depth === 8 ? (bytes.readUInt32LE(46) || 256) : 0;
  if (depth === 8 && (paletteSize > 256 || paletteOffset + paletteSize * 4 > pixelOffset)) return null;
  const bitmap = Buffer.alloc(width * height * 4);
  let hasAlpha = false;
  for (let y = 0; y < height; y++) {
    const sourceRow = pixelOffset + (signedHeight > 0 ? height - 1 - y : y) * rowBytes;
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      if (depth === 8) {
        const color = bytes[sourceRow + x];
        if (color >= paletteSize) return null;
        bytes.copy(bitmap, target, paletteOffset + color * 4, paletteOffset + color * 4 + 3);
        bitmap[target + 3] = 255;
      } else {
        const source = sourceRow + x * (depth / 8);
        bytes.copy(bitmap, target, source, source + 3);
        if (depth === 32) {
          bitmap[target + 3] = bytes[source + 3];
          hasAlpha ||= bitmap[target + 3] !== 0;
        } else bitmap[target + 3] = 255;
      }
    }
  }
  if (depth === 32 && !hasAlpha) for (let offset = 3; offset < bitmap.length; offset += 4) bitmap[offset] = 255;
  return { bitmap, width, height };
}

module.exports = { decodeBmp };
