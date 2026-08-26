import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings } from '../shared/types'

const settingsPath =
  process.env.SSHTERM_SETTINGS_PATH ??
  path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
    'sshterm',
    'settings.json'
  )

const defaults: AppSettings = {
  configFilePath: process.env.SSHTERM_CONFIG ?? path.join(os.homedir(), '.ssh', 'config'),
  scrollbackLines: 5000
}

function readSettings(): AppSettings {
  try {
    const stored = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Partial<AppSettings>
    return {
      configFilePath:
        typeof stored.configFilePath === 'string' && stored.configFilePath.trim()
          ? stored.configFilePath
          : defaults.configFilePath,
      scrollbackLines:
        typeof stored.scrollbackLines === 'number' && Number.isFinite(stored.scrollbackLines)
          ? stored.scrollbackLines
          : defaults.scrollbackLines
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      throw error
    }
    return { ...defaults }
  }
}

function writeSettings(settings: AppSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 })
  const temporaryPath = `${settingsPath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporaryPath, settingsPath)
}

export function getSettings(): AppSettings {
  return readSettings()
}

export function setConfigFilePath(configFilePath: string): AppSettings {
  const settings = getSettings()
  settings.configFilePath = configFilePath
  writeSettings(settings)
  return settings
}

export function updateSettings(input: {
  configFilePath?: string
  scrollbackLines?: number
}): AppSettings {
  const settings = getSettings()

  if (typeof input.configFilePath === 'string' && input.configFilePath.trim().length > 0) {
    settings.configFilePath = input.configFilePath.trim()
  }

  if (typeof input.scrollbackLines === 'number' && Number.isFinite(input.scrollbackLines)) {
    settings.scrollbackLines = Math.max(500, Math.min(200000, Math.floor(input.scrollbackLines)))
  }

  writeSettings(settings)
  return settings
}
