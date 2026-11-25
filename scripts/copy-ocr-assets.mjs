// Copies the files receipt reading needs into public/ocr, so they are served from this app's own address and never from a
// third-party server. Runs before `npm run dev` and `npm run build`. Only the LSTM builds are copied: that is the engine used.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'ocr')
mkdirSync(join(out, 'lang'), { recursive: true })

const copy = (from, to) => {
  if (!existsSync(from)) throw new Error(`Missing ${from}. Run "npm install" first.`)
  copyFileSync(from, to)
}

copy(join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'), join(out, 'worker.min.js'))
const core = join(root, 'node_modules', 'tesseract.js-core')
for (const f of readdirSync(core).filter((n) => /lstm\.wasm\.js$/.test(n))) copy(join(core, f), join(out, f))
copy(join(root, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), join(out, 'lang', 'eng.traineddata.gz'))
console.log('OCR files copied to public/ocr')
