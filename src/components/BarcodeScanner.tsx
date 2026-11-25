import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Flashlight, ImageUp, X } from 'lucide-react'
import { normalizeBarcode } from '../lib/barcode'
import { decodeImage, ScanError, startScan, type Scan } from '../lib/scanEngine'

const PROBLEM: Record<ScanError['kind'], string> = {
  denied: 'The camera is blocked. Allow the camera for this site in your browser settings, then reopen this. You can also type the number or take a photo below.',
  'no-camera': 'No camera was found on this device. You can type the number under the barcode instead.',
  insecure: 'The camera only works on a secure (https) address, so it is off here. Put the app online (see DEPLOY.md), or type the number under the barcode.',
  failed: 'The camera could not start. Close other apps that use it and try again, or type the number below.',
}

/**
 * A full-screen camera view that reads a barcode. If the camera is blocked or not available, typing the number under
 * the barcode or taking a photo of it still works. The camera is switched off however this closes.
 */
export default function BarcodeScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const uid = useId()
  const videoRef = useRef<HTMLVideoElement>(null)
  const scanRef = useRef<Scan | null>(null)
  const doneRef = useRef(false)
  const [problem, setProblem] = useState<ScanError['kind'] | null>(null)
  const [starting, setStarting] = useState(true)
  const [torch, setTorch] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [typed, setTyped] = useState('')
  const [typedError, setTypedError] = useState('')
  const [photoError, setPhotoError] = useState('')

  // Hand over a barcode, once. Anything that is not a real barcode (a misread, a mistyped digit) is refused.
  const accept = (raw: string): boolean => {
    const code = normalizeBarcode(raw)
    if (!code || doneRef.current) return false
    doneRef.current = true
    scanRef.current?.stop()
    navigator.vibrate?.(40)
    onCode(code)
    return true
  }
  const acceptRef = useRef(accept)
  useEffect(() => {
    acceptRef.current = accept // the camera callback always calls the latest version
  })

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    let cancelled = false
    startScan(videoRef.current!, (raw) => acceptRef.current(raw))
      .then((scan) => {
        if (cancelled) return scan.stop() // closed while the camera was still starting
        scanRef.current = scan
        setTorchSupported(scan.torchSupported)
        setStarting(false)
      })
      .catch((e) => {
        if (cancelled) return
        setProblem(e instanceof ScanError ? e.kind : 'failed')
        setStarting(false)
      })
    return () => {
      cancelled = true
      scanRef.current?.stop()
      document.body.style.overflow = overflow
      before?.focus?.()
    }
  }, [])

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!accept(typed)) setTypedError('That is not a valid barcode number. Check the digits under the bars (8, 12 or 13 numbers).')
  }

  const choosePhoto = async (file: File | undefined) => {
    setPhotoError('')
    if (!file) return
    const raw = await decodeImage(file)
    if (!raw || !accept(raw)) setPhotoError('No barcode could be read from that photo. Try again closer and in better light, or type the number.')
  }

  const toggleTorch = async () => {
    try {
      await scanRef.current?.setTorch(!torch)
      setTorch(!torch)
    } catch {
      setTorchSupported(false)
    }
  }

  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="sheet-body">
        <div className="sheet-head">
          <h2 id={`${uid}-title`}>Scan a barcode</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={24} aria-hidden />
          </button>
        </div>

        <div className={`scan-view${problem ? ' off' : ''}`}>
          <video ref={videoRef} playsInline muted aria-label="Camera view" />
          {!problem && <div className="scan-guide" aria-hidden />}
          {torchSupported && (
            <button type="button" className="scan-torch" aria-pressed={torch} onClick={toggleTorch}>
              <Flashlight size={20} aria-hidden /> {torch ? 'Light on' : 'Light'}
            </button>
          )}
        </div>
        {starting && !problem && (
          <p className="hint" role="status">
            Starting the camera…
          </p>
        )}
        {!starting && !problem && (
          <p className="hint" role="status">
            Hold the barcode inside the box. It reads by itself.
          </p>
        )}
        {problem && (
          <p className="empty" role="alert">
            {PROBLEM[problem]}
          </p>
        )}

        <form onSubmit={submitTyped} className="field">
          <label htmlFor={`${uid}-digits`}>Or type the number under the barcode</label>
          <div className="inline-row">
            <input
              id={`${uid}-digits`}
              className="input"
              inputMode="numeric"
              autoComplete="off"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value)
                setTypedError('')
              }}
              aria-invalid={!!typedError}
            />
            <button className="btn-primary" type="submit" disabled={typed.trim() === ''}>
              Look up
            </button>
          </div>
          {typedError && <p className="field-error">{typedError}</p>}
        </form>

        <div className="field">
          <label className="btn-quiet photo-pick">
            <ImageUp size={18} aria-hidden /> Take or choose a photo of the barcode
            <input type="file" accept="image/*" capture="environment" hidden aria-label="Barcode photo" onChange={(e) => choosePhoto(e.target.files?.[0])} />
          </label>
          {photoError && <p className="field-error">{photoError}</p>}
        </div>
        <p className="hint">Only the number is sent, to Open Food Facts, a free food database. The picture never leaves your phone.</p>
      </div>
    </div>,
    document.body,
  )
}
