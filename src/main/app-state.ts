/** 进程级的小状态，避免 window / tray / index 之间循环引用 */

let quitting = false

export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}
