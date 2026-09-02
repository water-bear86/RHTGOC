export class StartupDependencyTimeoutError extends Error {
  constructor(readonly dependency: string, readonly timeoutMs: number) {
    super(`${dependency} did not settle within ${timeoutMs}ms`)
    this.name = "StartupDependencyTimeoutError"
  }
}

export function withStartupDeadline<T>(dependency: string, operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new StartupDependencyTimeoutError(dependency, timeoutMs)), timeoutMs)
    operation.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}
