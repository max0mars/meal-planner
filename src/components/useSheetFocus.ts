import { useEffect } from 'react'

/** For a full-screen sheet: stop the page behind it scrolling, and give focus back to what opened it when it closes. */
export function useSheetFocus() {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      before?.focus?.()
    }
  }, [])
}
