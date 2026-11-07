export interface DisplayRect {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowPositionInput {
  cursorX: number
  cursorY: number
  windowWidth: number
  windowHeight: number
  display: DisplayRect
  margin?: number
  offset?: number
}

export function clampWindowPosition(input: WindowPositionInput): { x: number; y: number } {
  const margin = input.margin ?? 12
  const offset = input.offset ?? 16
  const minX = input.display.x + margin
  const minY = input.display.y + margin
  const maxX = input.display.x + input.display.width - input.windowWidth - margin
  const maxY = input.display.y + input.display.height - input.windowHeight - margin

  let x = input.cursorX + offset
  let y = input.cursorY + offset
  if (maxX >= minX && x > maxX) x = input.cursorX - input.windowWidth - offset
  if (maxY >= minY && y > maxY) y = input.cursorY - input.windowHeight - offset

  if (maxX < minX) x = minX
  else x = Math.min(Math.max(x, minX), maxX)
  if (maxY < minY) y = minY
  else y = Math.min(Math.max(y, minY), maxY)

  return { x: Math.round(x), y: Math.round(y) }
}
