import os from 'node:os'
import path from 'node:path'
import type { AppSettings } from '../shared/types'

const StoreModule = require('electron-store') as { default?: new (options: unknown) => unknown }
const StoreCtor = (StoreModule.default ?? StoreModule) as new <T>(options: unknown) => {
  get: <K extends keyof T>(key: K) => T[K]
  set: <K extends keyof T>(key: K, value: T[K]) => void
}

const store = new StoreCtor<AppSettings>({
  name: 'sshterm-settings',
  defaults: {
    configFilePath: path.join(os.homedir(), '.ssh', 'config'),
    scrollbackLines: 5000
  }
})

export function getSettings(): AppSettings {
  return {
    configFilePath: store.get('configFilePath'),
    scrollbackLines: store.get('scrollbackLines')
  }
}

export function setConfigFilePath(configFilePath: string): AppSettings {
  store.set('configFilePath', configFilePath)
  return getSettings()
}

export function updateSettings(input: {
  configFilePath?: string
  scrollbackLines?: number
}): AppSettings {
  if (typeof input.configFilePath === 'string' && input.configFilePath.trim().length > 0) {
    store.set('configFilePath', input.configFilePath.trim())
  }

  if (typeof input.scrollbackLines === 'number' && Number.isFinite(input.scrollbackLines)) {
    const value = Math.max(500, Math.min(200000, Math.floor(input.scrollbackLines)))
    store.set('scrollbackLines', value)
  }

  return getSettings()
}
