// Renders public/favicon.svg into the PNG icons the install prompt needs. Run: node scripts/make-icons.mjs
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const svg = readFileSync(join(root, 'favicon.svg'))
// "any" icons keep the rounded corners; the maskable one is full-bleed green because the phone cuts its own shape.
const square = Buffer.from(svg.toString().replace(/rx="112"/, 'rx="0"'))
for (const size of [192, 512]) await sharp(svg).resize(size, size).png().toFile(join(root, 'icons', `icon-${size}.png`))
await sharp(square).resize(512, 512).png().toFile(join(root, 'icons', 'maskable-512.png'))
await sharp(square).resize(180, 180).png().toFile(join(root, 'icons', 'apple-touch-icon.png'))
console.log('Wrote icons')
