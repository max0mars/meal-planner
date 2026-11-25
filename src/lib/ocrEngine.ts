// Reads the text on a receipt photo, on this device. The reading engine and its English data are this app's own files
// (copied into /ocr by scripts/copy-ocr-assets.mjs), loaded only when you first scan one, so nothing comes from or goes to
// anyone else. Kept apart from the screens so it can be replaced in tests.

export type OcrProgress = (fraction: number, label: string) => void

/**
 * Makes a photo easier to read: no bigger than 2000 pixels on its long side, in grey, with the contrast stretched so
 * faint thermal print stands out. Returns the same photo untouched if the browser cannot do this.
 */
export async function preprocess(file: Blob, maxSide = 2000): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const grey = new Uint8ClampedArray(canvas.width * canvas.height)
    const histogram = new Array<number>(256).fill(0)
    for (let i = 0; i < grey.length; i++) {
      const v = Math.round(0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2])
      grey[i] = v
      histogram[v]++
    }
    // stretch between the darkest and lightest 2% so one dark corner does not wash out the rest
    const cut = grey.length * 0.02
    let low = 0
    let high = 255
    for (let sum = 0; low < 255 && sum + histogram[low] < cut; low++) sum += histogram[low]
    for (let sum = 0; high > 0 && sum + histogram[high] < cut; high--) sum += histogram[high]
    const range = Math.max(1, high - low)
    for (let i = 0; i < grey.length; i++) {
      const v = Math.min(255, Math.max(0, Math.round(((grey[i] - low) * 255) / range)))
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    }
    ctx.putImageData(img, 0, 0)
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/png'))
  } catch {
    return file
  }
}

const here = () => new URL('ocr/', document.baseURI).href

/** The text on the receipt, line by line. Slow the first time (the engine loads), and reports its progress as it goes. */
export async function recognizeReceipt(photo: Blob, onProgress: OcrProgress = () => {}): Promise<string> {
  onProgress(0, 'Getting the photo ready')
  const image = await preprocess(photo)
  onProgress(0.05, 'Loading the reader')
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, {
    workerPath: `${here()}worker.min.js`,
    corePath: here(),
    langPath: `${here()}lang`,
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress(0.2 + m.progress * 0.8, 'Reading the receipt')
      else if (m.status === 'loading language traineddata') onProgress(0.1, 'Loading the reader')
    },
  })
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '4' as never, preserve_interword_spaces: '1' }) // one column of text, like a receipt
    const { data } = await worker.recognize(image)
    return data.text
  } finally {
    await worker.terminate()
  }
}
