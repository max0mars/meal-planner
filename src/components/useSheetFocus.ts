import { useEffect } from 'react'

// How many sheets are open. Sheets can sit inside one another (the receipt scanner shows its review sheet), and they close
// in any order, so the page only scrolls again once the last one has closed. Each sheet remembering and restoring what it
// saw would leave the page locked when an inner sheet closes after the outer one.
let open = 0
let before = ''

/** For a full-screen sheet: stop the page behind it scrolling, and give focus back to what opened it when it closes. */
export function useSheetFocus() {
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null
    if (open === 0) {
      before = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    open++
    return () => {
      open = Math.max(0, open - 1)
      if (open === 0) document.body.style.overflow = before
      focused?.focus?.()
    }
  }, [])
}
