import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, ImageUp, X } from 'lucide-react'
import { recognizeReceipt } from '../lib/ocrEngine'
import { parseReceipt, type ParsedReceipt } from '../lib/receipt'
import { todayIso } from '../lib/pantry'
import type { Ingredient } from '../types'
import ReceiptReview from './ReceiptReview'
import { useSheetFocus } from './useSheetFocus'

type Step = { kind: 'pick' } | { kind: 'reading'; fraction: number; label: string } | { kind: 'review'; parsed: ParsedReceipt } | { kind: 'failed'; message: string }

/**
 * Take or choose a photo of a receipt, read it on this device, then check what it found before anything is added.
 * The photo is never uploaded or saved: it is read in memory and dropped.
 */
export default function ReceiptFlow({
  foods,
  onList,
  onDone,
  onClose,
}: {
  foods: Ingredient[]
  onList: Set<number>
  onDone: (added: number) => void
  onClose: () => void
}) {
  const uid = useId()
  useSheetFocus()
  const [step, setStep] = useState<Step>({ kind: 'pick' })
  const closedRef = useRef(false)
  useEffect(() => {
    closedRef.current = false
    return () => {
      closedRef.current = true // a reading that finishes after you leave must not open anything
    }
  }, [])

  const read = async (file: File | undefined) => {
    if (!file) return
    setStep({ kind: 'reading', fraction: 0, label: 'Getting the photo ready' })
    try {
      const text = await recognizeReceipt(file, (fraction, label) => {
        if (!closedRef.current) setStep({ kind: 'reading', fraction, label })
      })
      if (closedRef.current) return
      setStep({ kind: 'review', parsed: parseReceipt(text, foods, todayIso()) })
    } catch {
      if (!closedRef.current) {
        setStep({
          kind: 'failed',
          message: 'The receipt could not be read. Check you are online the first time (the reader is downloaded once), then try again.',
        })
      }
    }
  }

  if (step.kind === 'review') return <ReceiptReview parsed={step.parsed} foods={foods} onList={onList} onDone={onDone} onClose={onClose} />

  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="sheet-body">
        <div className="sheet-head">
          <h2 id={`${uid}-title`}>Scan a receipt</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={24} aria-hidden />
          </button>
        </div>

        {step.kind === 'reading' ? (
          <div role="status" className="reading">
            <p>
              <strong>{step.label}…</strong>
            </p>
            <progress max={1} value={step.fraction} aria-label="Reading progress" />
            <p className="hint">The first time takes longer, because the reader is downloaded once. Everything stays on this phone.</p>
          </div>
        ) : (
          <>
            <p className="hint">
              Photograph the whole receipt, flat and in good light. It is read on your phone: the picture is never uploaded or kept. You check everything
              before it goes into your pantry.
            </p>
            {step.kind === 'failed' && (
              <p className="empty" role="alert">
                {step.message}
              </p>
            )}
            <label className="btn-primary photo-big">
              <Camera size={20} aria-hidden /> Take a photo
              <input type="file" accept="image/*" capture="environment" hidden aria-label="Receipt photo" onChange={(e) => read(e.target.files?.[0])} />
            </label>
            <label className="btn-quiet photo-pick">
              <ImageUp size={18} aria-hidden /> Choose a photo you already took
              <input type="file" accept="image/*" hidden aria-label="Receipt from your photos" onChange={(e) => read(e.target.files?.[0])} />
            </label>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
