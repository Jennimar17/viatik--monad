/** A promise that took longer than it was given. */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timeout after ${ms / 1000}s`)
    this.name = 'TimeoutError'
  }
}

/** The promise's outcome, or a `TimeoutError` after `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
