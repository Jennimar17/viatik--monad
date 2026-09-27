/**
 * Minimal QR Code encoder (ISO/IEC 18004): byte mode, error correction level
 * L, versions 1–5, so a deposit address renders as a real, scannable code
 * without a dependency. Returns the module matrix; rendering is separate.
 */

const EC_CODEWORDS = [0, 7, 10, 15, 20, 26] as const
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134] as const
/** Error correction level L in the format information. */
const EC_LEVEL_BITS = 1

type Matrix = boolean[][]

export function encodeQr(text: string): Matrix {
  const bytes = Array.from(new TextEncoder().encode(text))
  const version = smallestVersion(bytes.length)
  const size = version * 4 + 17
  const dataCapacity = TOTAL_CODEWORDS[version] - EC_CODEWORDS[version]

  const bits: number[] = []
  appendBits(bits, 0b0100, 4)
  appendBits(bits, bytes.length, 8)
  for (const byte of bytes) appendBits(bits, byte, 8)
  appendBits(bits, 0, Math.min(4, dataCapacity * 8 - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)
  for (let pad = 0xec; bits.length < dataCapacity * 8; pad ^= 0xec ^ 0x11) appendBits(bits, pad, 8)

  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0)
    data.push(byte)
  }
  const codewords = [...data, ...reedSolomonRemainder(data, EC_CODEWORDS[version])]

  const modules: Matrix = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  const isFunction: Matrix = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  const setFunction = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark
    isFunction[y]![x] = true
  }

  drawFunctionPatterns(size, version, setFunction)
  drawFormatBits(size, 0, setFunction)
  placeData(size, codewords, modules, isFunction)

  let best = 0
  let bestPenalty = Number.POSITIVE_INFINITY
  for (let mask = 0; mask < 8; mask++) {
    applyMask(size, mask, modules, isFunction)
    drawFormatBits(size, mask, setFunction)
    const penalty = penaltyScore(size, modules)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      best = mask
    }
    applyMask(size, mask, modules, isFunction)
  }
  applyMask(size, best, modules, isFunction)
  drawFormatBits(size, best, setFunction)
  return modules
}

function smallestVersion(byteCount: number): 1 | 2 | 3 | 4 | 5 {
  for (const version of [1, 2, 3, 4, 5] as const) {
    const capacity = TOTAL_CODEWORDS[version] - EC_CODEWORDS[version]
    if (4 + 8 + byteCount * 8 <= capacity * 8) return version
  }
  throw new Error('Text too long for a small QR code.')
}

function appendBits(bits: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
}

// ─── Reed–Solomon over GF(256), primitive polynomial 0x11D ───────────────────

function multiply(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function reedSolomonRemainder(data: number[], degree: number): number[] {
  const divisor = Array<number>(degree).fill(0)
  divisor[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      divisor[j] = multiply(divisor[j] ?? 0, root)
      if (j + 1 < degree) divisor[j] = (divisor[j] ?? 0) ^ (divisor[j + 1] ?? 0)
    }
    root = multiply(root, 0x02)
  }
  const result = Array<number>(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0)
    result.push(0)
    for (let i = 0; i < degree; i++) result[i] = (result[i] ?? 0) ^ multiply(divisor[i] ?? 0, factor)
  }
  return result
}

// ─── Function patterns ───────────────────────────────────────────────────────

type SetModule = (x: number, y: number, dark: boolean) => void

function drawFunctionPatterns(size: number, version: number, set: SetModule) {
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  drawFinder(size, 3, 3, set)
  drawFinder(size, size - 4, 3, set)
  drawFinder(size, 3, size - 4, set)
  if (version > 1) {
    const positions = [6, size - 7]
    for (const cx of positions) {
      for (const cy of positions) {
        const overlapsFinder =
          (cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)
        if (!overlapsFinder) drawAlignment(cx, cy, set)
      }
    }
  }
}

function drawFinder(size: number, cx: number, cy: number, set: SetModule) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || y < 0 || x >= size || y >= size) continue
      const distance = Math.max(Math.abs(dx), Math.abs(dy))
      set(x, y, distance !== 2 && distance !== 4)
    }
  }
}

function drawAlignment(cx: number, cy: number, set: SetModule) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
}

function drawFormatBits(size: number, mask: number, set: SetModule) {
  const data = (EC_LEVEL_BITS << 3) | mask
  let remainder = data
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
  const bits = ((data << 10) | remainder) ^ 0x5412
  const bit = (i: number) => ((bits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) set(8, i, bit(i))
  set(8, 7, bit(6))
  set(8, 8, bit(7))
  set(7, 8, bit(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
  set(8, size - 8, true)
}

// ─── Data placement and masking ──────────────────────────────────────────────

function placeData(size: number, codewords: number[], modules: Matrix, isFunction: Matrix) {
  let index = 0
  const total = codewords.length * 8
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vertical : vertical
        if (!isFunction[y]![x] && index < total) {
          modules[y]![x] = ((codewords[index >>> 3]! >>> (7 - (index & 7))) & 1) === 1
          index++
        }
      }
    }
  }
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0
    case 1:
      return y % 2 === 0
    case 2:
      return x % 3 === 0
    case 3:
      return (x + y) % 3 === 0
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  }
}

function applyMask(size: number, mask: number, modules: Matrix, isFunction: Matrix) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunction[y]![x] && maskBit(mask, x, y)) modules[y]![x] = !modules[y]![x]
    }
  }
}

/** Standard penalty rules, so the chosen mask keeps the code easy to scan. */
function penaltyScore(size: number, modules: Matrix): number {
  let score = 0
  const at = (x: number, y: number) => modules[y]![x]!

  // Rules 1 and 3 on one row or column: long runs, and finder-like 1:1:3:1:1 patterns.
  const scanLine = (module: (i: number) => boolean) => {
    let runColor = false
    let run = 0
    const history = [0, 0, 0, 0, 0, 0, 0]
    const addHistory = (length: number) => {
      // The quiet zone counts as a light run before the first module.
      if (history[0] === 0) length += size
      history.pop()
      history.unshift(length)
    }
    for (let i = 0; i < size; i++) {
      if (module(i) === runColor) {
        run++
        if (run === 5) score += 3
        else if (run > 5) score++
      } else {
        addHistory(run)
        if (!runColor) score += finderLikePatterns(history) * 40
        runColor = module(i)
        run = 1
      }
    }
    if (runColor) {
      addHistory(run)
      run = 0
    }
    addHistory(run + size)
    score += finderLikePatterns(history) * 40
  }
  for (let y = 0; y < size; y++) scanLine((x) => at(x, y))
  for (let x = 0; x < size; x++) scanLine((y) => at(x, y))

  // Rule 2: 2×2 blocks of one color.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = at(x, y)
      if (color === at(x + 1, y) && color === at(x, y + 1) && color === at(x + 1, y + 1)) score += 3
    }
  }

  // Rule 4: balance of dark modules.
  let dark = 0
  for (const row of modules) for (const cell of row) if (cell) dark++
  const total = size * size
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  return score + k * 10
}

/** Dark/light run history [light, dark, light, dark, light, dark, light] ending in a light run. */
function finderLikePatterns(history: number[]): number {
  const n = history[1] ?? 0
  const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n
  if (!core) return 0
  const before = history[0] ?? 0
  const after = history[6] ?? 0
  return (before >= n * 4 && after >= n ? 1 : 0) + (after >= n * 4 && before >= n ? 1 : 0)
}
