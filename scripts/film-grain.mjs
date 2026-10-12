// Generates public/images/film-grain.png: the 192×192 grayscale noise tile behind the landing's and the
// app's glass surfaces (.grain in src/styles/effects.css, the app canvas in src/styles/dashboard.css).
// It is made here, from a fixed seed, so the texture is the project's own work (MIT) and always the same.
//
//   node scripts/film-grain.mjs            writes the tile
//   node scripts/film-grain.mjs --stats    prints the brightness and contrast of the current tile
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'public/images/film-grain.png')
const SIZE = 192
/** Mean and spread of each pixel's gray level, matched to the tile the landing was designed with. */
const MEAN = 128
const SPREAD = 37
const SEED = 0x5eed_7a11

/** Mulberry32: a small deterministic generator, so every run writes the same bytes. */
function random(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A normally distributed value (Box–Muller). */
function gaussian(next) {
  const u = Math.max(next(), Number.EPSILON)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes) {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** Encodes an 8-bit RGB image (rows of SIZE × 3 bytes) as PNG, filter type 0 on every row. */
function encodePng(rgb) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB, like the original tile
  const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE)
  for (let y = 0; y < SIZE; y++) rgb.copy(raw, y * (SIZE * 3 + 1) + 1, y * SIZE * 3, (y + 1) * SIZE * 3)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Decodes an 8-bit RGB, non-interlaced PNG (enough for --stats on the tile). */
function decodePng(bytes) {
  let offset = 8
  let width = 0
  let height = 0
  const idat = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 2) throw new Error('only 8-bit RGB tiles are supported')
    }
    if (type === 'IDAT') idat.push(data)
    offset += 12 + length
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * 3
  const out = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x]
      const left = x >= 3 ? out[y * stride + x - 3] : 0
      const up = y > 0 ? out[(y - 1) * stride + x] : 0
      const upLeft = x >= 3 && y > 0 ? out[(y - 1) * stride + x - 3] : 0
      let value = cur
      if (filter === 1) value = cur + left
      else if (filter === 2) value = cur + up
      else if (filter === 3) value = cur + ((left + up) >> 1)
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        value = cur + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
      }
      out[y * stride + x] = value & 0xff
    }
  }
  return out
}

function stats(rgb) {
  let sum = 0
  let sq = 0
  const n = rgb.length / 3
  for (let i = 0; i < rgb.length; i += 3) {
    const gray = (rgb[i] + rgb[i + 1] + rgb[i + 2]) / 3
    sum += gray
    sq += gray * gray
  }
  const mean = sum / n
  return { mean: Math.round(mean * 10) / 10, spread: Math.round(Math.sqrt(sq / n - mean * mean) * 10) / 10 }
}

if (process.argv.includes('--stats')) {
  console.log(JSON.stringify(stats(decodePng(fs.readFileSync(OUT)))))
} else {
  const next = random(SEED)
  const rgb = Buffer.alloc(SIZE * SIZE * 3)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const gray = Math.max(0, Math.min(255, Math.round(MEAN + SPREAD * gaussian(next))))
    rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = gray
  }
  fs.writeFileSync(OUT, encodePng(rgb))
  console.log(`Wrote ${path.relative(root, OUT)} ${JSON.stringify(stats(rgb))}`)
}
