export interface DisplayRect {
  x: number
  y: number
  width: number
  height: number
}

export type PopupPlacement = 'below' | 'above'

/**
 * Decide once, when the popup opens, whether it grows down from the cursor or up from it.
 * Deciding up front keeps the pill from jumping sides while the answer streams in.
 */
export function choosePlacement(cursorY: number, display: DisplayRect, expectedHeight = 440, offset = 14): PopupPlacement {
  const bottom = display.y + display.height
  return cursorY + offset + expectedHeight <= bottom ? 'below' : 'above'
}

export interface PopupInput {
  cursorX: number
  cursorY: number
  width: number
  height: number
  display: DisplayRect
  placement: PopupPlacement
  margin?: number
  offset?: number
  /** How far left of the cursor the window starts, so the pill sits just under the pointer. */
  lead?: number
}

/** Position a content-sized popup next to the cursor, staying inside the display. */
export function placePopup(input: PopupInput): { x: number; y: number } {
  const margin = input.margin ?? 8
  const offset = input.offset ?? 14
  const lead = input.lead ?? 18
  const left = input.display.x + margin
  const top = input.display.y + margin
  const right = input.display.x + input.display.width - margin
  const bottom = input.display.y + input.display.height - margin

  let x = input.cursorX - lead
  let y = input.placement === 'below' ? input.cursorY + offset : input.cursorY - offset - input.height

  x = Math.min(x, right - input.width)
  x = Math.max(x, left)
  y = Math.min(y, bottom - input.height)
  y = Math.max(y, top)
  return { x: Math.round(x), y: Math.round(y) }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Gemini returns boxes as [ymin, xmin, ymax, xmax] on a 0–1000 scale relative to the image.
 * The image is a capture of one whole display, so the box maps onto that display's bounds,
 * which also works for secondary displays at negative or offset coordinates.
 */
export function boxToScreen(box: [number, number, number, number], display: DisplayRect): Rect {
  const clamp = (value: number) => Math.min(Math.max(value, 0), 1000)
  const [y0, x0, y1, x1] = box.map(clamp)
  const top = Math.min(y0, y1)
  const left = Math.min(x0, x1)
  const bottom = Math.max(y0, y1)
  const right = Math.max(x0, x1)
  return {
    x: Math.round(display.x + (left / 1000) * display.width),
    y: Math.round(display.y + (top / 1000) * display.height),
    width: Math.max(1, Math.round(((right - left) / 1000) * display.width)),
    height: Math.max(1, Math.round(((bottom - top) / 1000) * display.height))
  }
}
