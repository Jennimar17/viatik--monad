import * as React from 'react'

const OVERLAY = '[role="dialog"], [role="alertdialog"]'

/**
 * Gives focus back to the element that was focused before an overlay opened,
 * once the overlay has closed and nothing else took it.
 *
 * Base UI does this for overlays opened from a `Trigger`, but the product
 * opens sheets and dialogs from state (a row button, a menu item) and often
 * unmounts them as soon as they close, so the built-in return can be lost.
 * The last element focused outside any overlay is tracked from `focusin`.
 */
export function useReturnFocus() {
  const lastOutside = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || target.closest(OVERLAY)) return
      lastOutside.current = target
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  return React.useCallback(() => {
    const target = lastOutside.current
    if (!target || !target.isConnected) return
    // Focus still inside the closing overlay would drop to <body> once the
    // overlay unmounts; anything else means the person already moved on.
    const active = document.activeElement
    if (active && active !== document.body && !active.closest(OVERLAY)) return
    target.focus({ preventScroll: true })
  }, [])
}
