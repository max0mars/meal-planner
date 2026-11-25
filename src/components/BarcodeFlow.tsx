import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { draftFromProduct, lookupBarcode, productNotices, type Product } from '../lib/barcode'
import { emptyDraft, type FoodDraft } from '../lib/customFood'
import type { Ingredient } from '../types'
import BarcodeScanner from './BarcodeScanner'

/** What a scan turned into when the food is not one you have yet: a form to check, and what to tell you about it. */
export interface ScannedFood {
  draft: FoodDraft
  notices: string[]
  /** The pack size, if the label gave one. */
  product?: Product
}

/**
 * Scan, look up, and hand back one of two things: a food you already have (found by its barcode), or a filled-in form
 * to review. It never saves anything itself.
 */
export default function BarcodeFlow({
  onKnown,
  onNew,
  onClose,
}: {
  onKnown: (food: Ingredient) => void
  onNew: (scanned: ScannedFood) => void
  onClose: () => void
}) {
  const uid = useId()
  const [code, setCode] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // the lookup below should run once per code or retry, but always call the latest handlers
  const handlers = useRef({ onKnown, onNew })
  useEffect(() => {
    handlers.current = { onKnown, onNew }
  })

  useEffect(() => {
    if (!code) return
    let cancelled = false
    lookupBarcode(code).then((result) => {
      if (cancelled) return
      if (result.kind === 'local') handlers.current.onKnown(result.food)
      else if (result.kind === 'found') handlers.current.onNew({ draft: draftFromProduct(result.product), notices: productNotices(result.product), product: result.product })
      else if (result.kind === 'unknown') {
        handlers.current.onNew({
          draft: { ...emptyDraft(), barcode: code },
          notices: ['This barcode is not in the food database. Fill it in from the label. It will be remembered, so next time a scan finds it.'],
        })
      } else setOffline(true)
    })
    return () => {
      cancelled = true
    }
  }, [code, attempt])

  if (!code) return <BarcodeScanner onCode={setCode} onClose={onClose} />

  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="sheet-body">
        <div className="sheet-head">
          <h2 id={`${uid}-title`}>Barcode {code}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={24} aria-hidden />
          </button>
        </div>
        {!offline ? (
          <p className="hint" role="status">
            Looking it up…
          </p>
        ) : (
          <>
            <p className="empty" role="alert">
              Could not reach the food database. Check your connection, or fill the food in by hand and it will keep this barcode.
            </p>
            <div className="filters">
              <button
                type="button"
                className="on"
                onClick={() => {
                  setOffline(false)
                  setAttempt(attempt + 1)
                }}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => onNew({ draft: { ...emptyDraft(), barcode: code }, notices: ['No connection, so nothing was looked up. Fill it in from the label.'] })}
              >
                Enter it by hand
              </button>
              <button
                type="button"
                onClick={() => {
                  setOffline(false)
                  setCode(null)
                }}
              >
                Scan again
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
