export interface ObjectivePointerLayout {
  visible: boolean
  x: number
  y: number
  angleDegrees: number
  distanceLabel: string
}

interface PointerInput {
  ndcX: number
  ndcY: number
  ndcZ: number
  viewportWidth: number
  viewportHeight: number
  distanceMeters: number
}

/** Places a discovered objective indicator on the screen edge when the world marker is off camera. */
export function computeObjectivePointer(input: PointerInput): ObjectivePointerLayout {
  const marginX = Math.min(76, input.viewportWidth * 0.12)
  const marginTop = Math.min(150, input.viewportHeight * 0.18)
  const marginBottom = Math.min(86, input.viewportHeight * 0.12)
  const behindCamera = input.ndcZ > 1
  const directionX = behindCamera ? -input.ndcX : input.ndcX
  const directionY = behindCamera ? input.ndcY : -input.ndcY
  const onScreen = !behindCamera && Math.abs(input.ndcX) <= 0.82 && Math.abs(input.ndcY) <= 0.72
  const desiredX = (directionX * 0.5 + 0.5) * input.viewportWidth
  const desiredY = (directionY * 0.5 + 0.5) * input.viewportHeight
  const x = Math.max(marginX, Math.min(input.viewportWidth - marginX, desiredX))
  const y = Math.max(marginTop, Math.min(input.viewportHeight - marginBottom, desiredY))
  const angleDegrees = Math.atan2(y - input.viewportHeight / 2, x - input.viewportWidth / 2) * 180 / Math.PI + 90
  return {
    visible: !onScreen,
    x,
    y,
    angleDegrees,
    distanceLabel: `${Math.max(0, Math.round(input.distanceMeters))}m`,
  }
}

