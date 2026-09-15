import crypto from 'node:crypto'

if (typeof globalThis.crypto === 'undefined') {
  // @ts-ignore
  globalThis.crypto = crypto
}
if (typeof global !== 'undefined' && typeof global.crypto === 'undefined') {
  // @ts-ignore
  global.crypto = crypto
}
