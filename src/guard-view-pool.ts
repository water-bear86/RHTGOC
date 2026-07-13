export function syncGuardViewCount<T>(
  views: T[],
  guardCount: number,
  createView: () => T,
  attachView: (view: T) => void,
  detachView: (view: T) => void,
): void {
  while (views.length < guardCount) {
    const view = createView()
    views.push(view)
    attachView(view)
  }
  while (views.length > guardCount) {
    const view = views.pop()
    if (view !== undefined) detachView(view)
  }
}
