// The camera and the barcode reader. Kept apart from the screens so it can be replaced in tests (jsdom has no camera).

export type ScanErrorKind =
  /** The person (or the browser) said no to the camera. */
  | 'denied'
  | 'no-camera'
  /** Cameras only work on https addresses (and localhost). */
  | 'insecure'
  | 'failed'

export class ScanError extends Error {
  kind: ScanErrorKind
  constructor(kind: ScanErrorKind) {
    super(kind)
    this.kind = kind
  }
}

export interface Scan {
  /** Stops the reader and switches the camera off. Safe to call twice. */
  stop(): void
  torchSupported: boolean
  setTorch(on: boolean): Promise<void>
}

// The browser's own reader (Chrome and Android) is not in TypeScript's types yet.
interface NativeDetector {
  detect(source: CanvasImageSource | ImageBitmap): Promise<{ rawValue: string }[]>
}
type NativeDetectorCtor = new (options: { formats: string[] }) => NativeDetector
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']
const nativeDetector = (): NativeDetectorCtor | undefined => (window as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector

export function cameraAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

async function openCamera(): Promise<MediaStream> {
  if (!window.isSecureContext) throw new ScanError('insecure')
  if (!cameraAvailable()) throw new ScanError('no-camera')
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
  } catch (e) {
    const name = (e as DOMException | undefined)?.name
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new ScanError('denied')
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new ScanError('no-camera')
    throw new ScanError('failed')
  }
}

/** Points the camera at `video` and calls `onCode` with each barcode it reads, until stopped. */
export async function startScan(video: HTMLVideoElement, onCode: (raw: string) => void): Promise<Scan> {
  const stream = await openCamera()
  let stopped = false
  let stopReader = () => {}
  const stop = () => {
    if (stopped) return
    stopped = true
    stopReader()
    for (const track of stream.getTracks()) track.stop() // this is what turns the camera light off
    video.srcObject = null
  }
  try {
    video.srcObject = stream
    video.muted = true
    video.setAttribute('playsinline', 'true')
    await video.play()

    const Native = nativeDetector()
    if (Native) {
      const detector = new Native({ formats: FORMATS })
      const timer = setInterval(async () => {
        if (stopped || video.readyState < 2) return
        try {
          const found = await detector.detect(video)
          if (!stopped && found[0]) onCode(found[0].rawValue)
        } catch {
          /* a frame that cannot be read is just skipped */
        }
      }, 200)
      stopReader = () => clearInterval(timer)
    } else {
      // Safari and Firefox have no built-in reader, so load one on demand.
      const { BrowserMultiFormatReader } = await import('@zxing/browser')
      const { BarcodeFormat, DecodeHintType } = await import('@zxing/library')
      const hints = new Map<number, unknown>([
        [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
      ])
      const reader = new BrowserMultiFormatReader(hints as never)
      const controls = await reader.decodeFromStream(stream, video, (result) => {
        if (!stopped && result) onCode(result.getText())
      })
      stopReader = () => controls.stop()
    }
  } catch (e) {
    stop()
    throw e instanceof ScanError ? e : new ScanError('failed')
  }

  const track = stream.getVideoTracks()[0]
  const torchSupported = !!(track?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch
  return {
    stop,
    torchSupported,
    setTorch: async (on) => {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
    },
  }
}

/** Reads a barcode out of a photo. Returns the number, or null if none could be read. */
export async function decodeImage(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file)
  try {
    const Native = nativeDetector()
    if (Native) {
      const bitmap = await createImageBitmap(file)
      const found = await new Native({ formats: FORMATS }).detect(bitmap)
      bitmap.close?.()
      return found[0]?.rawValue ?? null
    }
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    const result = await new BrowserMultiFormatReader().decodeFromImageUrl(url)
    return result.getText()
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}
