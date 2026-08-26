/// <reference types="vite/client" />

import type { SshtermApi } from '../../shared/api'

declare global {
  interface Window {
    api: SshtermApi
  }
}
