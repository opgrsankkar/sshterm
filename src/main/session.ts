import os from 'node:os'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import pty, { type IPty } from 'node-pty'
import type { CreateSessionRequest } from '../shared/types'

interface SessionRecord {
  pty: IPty
  alias: string
  configPath: string
  recentOutput: string
  hostKeyAlerted: boolean
  authFailureAlerted: boolean
  authMode: NonNullable<CreateSessionRequest['authMode']>
}

export interface HostKeyChangedEvent {
  sessionId: string
  alias: string
  fingerprint: string | null
  knownHostsPath: string | null
  offendingLine: number | null
  message: string
}

export interface AuthenticationFallbackEvent {
  sessionId: string
  alias: string
  message: string
  suggestedPreferredAuthentications: string
  debugSummary: string | null
}

const execFileAsync = promisify(execFile)
const PASSWORD_FALLBACK_PREFERRED_AUTHENTICATIONS = 'password,keyboard-interactive'

function resolveSshBinary(): string {
  const candidates = ['/usr/bin/ssh', '/opt/homebrew/bin/ssh', '/usr/local/bin/ssh']
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }
  return '/usr/bin/ssh'
}

function buildPtyEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value
    }
  }

  const fallbackPath = '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin'
  env.PATH = env.PATH && env.PATH.trim().length > 0 ? env.PATH : fallbackPath
  env.TERM = 'xterm-256color'
  return env
}

let helperPermissionsChecked = false

function ensureNodePtyHelperExecutable(): void {
  if (helperPermissionsChecked || process.platform !== 'darwin') {
    return
  }

  helperPermissionsChecked = true
  try {
    const packageJsonPath = require.resolve('node-pty/package.json')
    const nodePtyRoot = path.dirname(packageJsonPath)
    const helperPath = path.join(
      nodePtyRoot,
      'prebuilds',
      `${process.platform}-${process.arch}`,
      'spawn-helper'
    )

    if (!fs.existsSync(helperPath)) {
      return
    }

    const stats = fs.statSync(helperPath)
    if ((stats.mode & 0o111) === 0) {
      fs.chmodSync(helperPath, 0o755)
    }
  } catch {
    // best-effort only; spawn will throw with a clear message if this fails
  }
}

export class SessionManager {
  private sessions = new Map<string, SessionRecord>()

  constructor(
    private readonly onData: (sessionId: string, data: string) => void,
    private readonly onExit: (sessionId: string, exitCode: number) => void,
    private readonly onHostKeyChanged: (event: HostKeyChangedEvent) => void,
    private readonly onAuthenticationFallbackSuggested: (event: AuthenticationFallbackEvent) => void
  ) {}

  createSession(request: CreateSessionRequest, configPath: string): string {
    ensureNodePtyHelperExecutable()

    const sessionId = randomUUID()
    const shell = resolveSshBinary()
    const authMode = request.authMode ?? 'default'
    const args = buildSshArgs(request.alias, configPath, authMode)

    let instance: IPty
    try {
      instance = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: request.cols,
        rows: request.rows,
        cwd: os.homedir(),
        env: buildPtyEnv()
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to start SSH process (${shell}): ${message}`)
    }

    this.sessions.set(sessionId, {
      pty: instance,
      alias: request.alias,
      configPath,
      recentOutput: '',
      hostKeyAlerted: false,
      authFailureAlerted: false,
      authMode
    })

    instance.onData((data) => {
      this.onData(sessionId, data)
      const record = this.sessions.get(sessionId)
      if (!record) return

      record.recentOutput = `${record.recentOutput}${data}`
      if (record.recentOutput.length > 12000) {
        record.recentOutput = record.recentOutput.slice(-12000)
      }

      if (!record.hostKeyAlerted) {
        const hostKey = detectHostKeyChange(record.recentOutput)
        if (hostKey) {
          record.hostKeyAlerted = true
          this.onHostKeyChanged({
            sessionId,
            alias: record.alias,
            fingerprint: hostKey.fingerprint,
            knownHostsPath: hostKey.knownHostsPath,
            offendingLine: hostKey.offendingLine,
            message: hostKey.message
          })
        }
      }

      if (record.authFailureAlerted || record.authMode !== 'default') {
        return
      }

      if (!detectTooManyAuthenticationFailures(record.recentOutput)) {
        return
      }

      record.authFailureAlerted = true
      void this.confirmRepeatedKeyAuthAndSuggestFallback(sessionId, record.alias, record.configPath)
    })

    instance.onExit(({ exitCode }) => {
      this.sessions.delete(sessionId)
      this.onExit(sessionId, exitCode)
    })

    return sessionId
  }

  writeInput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.pty.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.pty.resize(Math.max(2, cols), Math.max(1, rows))
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.pty.kill()
    this.sessions.delete(sessionId)
  }

  acceptHostKeyChange(alias: string, configPath: string): void {
    const resolved = resolveAliasTarget(alias, configPath)
    const knownHostsPath = path.join(os.homedir(), '.ssh', 'known_hosts')
    const sshKeygenPath = resolveSshKeygenBinary()

    const targets = new Set<string>([alias])
    if (resolved.hostname) {
      targets.add(resolved.hostname)
      if (resolved.port && resolved.port !== '22') {
        targets.add(`[${resolved.hostname}]:${resolved.port}`)
      }
    }

    for (const target of targets) {
      try {
        execFileSync(sshKeygenPath, ['-R', target, '-f', knownHostsPath], {
          stdio: 'pipe'
        })
      } catch {
        // best effort: continue removing remaining variants
      }
    }
  }

  private async confirmRepeatedKeyAuthAndSuggestFallback(
    sessionId: string,
    alias: string,
    configPath: string
  ): Promise<void> {
    const diagnosis = await diagnoseRepeatedKeyAuthentication(alias, configPath)
    if (!diagnosis.confirmed) {
      const record = this.sessions.get(sessionId)
      if (record) {
        record.authFailureAlerted = false
      }
      return
    }

    this.onAuthenticationFallbackSuggested({
      sessionId,
      alias,
      message:
        'SSH exhausted repeated key-based authentication attempts. Retrying with password and keyboard-interactive disables public-key auth for this reconnect attempt.',
      suggestedPreferredAuthentications: PASSWORD_FALLBACK_PREFERRED_AUTHENTICATIONS,
      debugSummary: diagnosis.summary
    })
  }
}

function buildSshArgs(
  alias: string,
  configPath: string,
  authMode: NonNullable<CreateSessionRequest['authMode']>
): string[] {
  const args = ['-F', configPath]

  if (authMode === 'passwordFallback') {
    args.push(
      '-o',
      `PreferredAuthentications=${PASSWORD_FALLBACK_PREFERRED_AUTHENTICATIONS}`,
      '-o',
      'PubkeyAuthentication=no',
      '-o',
      'PasswordAuthentication=yes',
      '-o',
      'KbdInteractiveAuthentication=yes'
    )
  }

  args.push(alias)
  return args
}

function detectTooManyAuthenticationFailures(output: string): boolean {
  return /Too many authentication failures/i.test(output)
}

async function diagnoseRepeatedKeyAuthentication(
  alias: string,
  configPath: string
): Promise<{ confirmed: boolean; summary: string | null }> {
  const sshPath = resolveSshBinary()
  const args = [
    '-vvv',
    '-F',
    configPath,
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=5',
    '-o',
    'NumberOfPasswordPrompts=0',
    '-o',
    'PreferredAuthentications=publickey',
    '-o',
    'PasswordAuthentication=no',
    '-o',
    'KbdInteractiveAuthentication=no',
    alias
  ]

  let combinedOutput = ''
  try {
    const result = await execFileAsync(sshPath, args, {
      encoding: 'utf8',
      env: buildPtyEnv(),
      timeout: 8000,
      maxBuffer: 256 * 1024
    })
    combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  } catch (error) {
    const stdout =
      typeof error === 'object' && error && 'stdout' in error ? String(error.stdout ?? '') : ''
    const stderr =
      typeof error === 'object' && error && 'stderr' in error ? String(error.stderr ?? '') : ''
    combinedOutput = `${stdout}\n${stderr}`
  }

  const normalizedOutput = combinedOutput.trim()
  if (!normalizedOutput) {
    return { confirmed: false, summary: null }
  }

  const publicKeyOfferCount =
    normalizedOutput.match(/Offering public key:|Will attempt key:|Trying private key:/g)?.length ??
    0
  const confirmed =
    /Too many authentication failures/i.test(normalizedOutput) && publicKeyOfferCount > 0

  if (!confirmed) {
    return { confirmed: false, summary: null }
  }

  return {
    confirmed: true,
    summary: `ssh -vvv saw ${publicKeyOfferCount} key-based authentication attempt${publicKeyOfferCount === 1 ? '' : 's'} before disconnecting with "Too many authentication failures".`
  }
}

function detectHostKeyChange(output: string): {
  fingerprint: string | null
  knownHostsPath: string | null
  offendingLine: number | null
  message: string
} | null {
  if (!output.includes('WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!')) {
    return null
  }

  const fingerprintMatch = output.match(/The fingerprint for .*? is\s+([\w:+/=.-]+)\.?/s)
  const offendingMatch = output.match(/Offending .* key in\s+(.+?):(\d+)/)

  return {
    fingerprint: fingerprintMatch?.[1] ?? null,
    knownHostsPath: offendingMatch?.[1] ?? null,
    offendingLine: offendingMatch ? Number(offendingMatch[2]) : null,
    message: 'Remote host key changed. Accepting will remove old known_hosts entries and reconnect.'
  }
}

function resolveSshKeygenBinary(): string {
  const candidates = [
    '/usr/bin/ssh-keygen',
    '/opt/homebrew/bin/ssh-keygen',
    '/usr/local/bin/ssh-keygen'
  ]
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }
  return '/usr/bin/ssh-keygen'
}

function resolveAliasTarget(
  alias: string,
  configPath: string
): { hostname: string | null; port: string | null } {
  const sshPath = resolveSshBinary()
  try {
    const rendered = execFileSync(sshPath, ['-G', '-F', configPath, alias], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const lines = rendered.split(/\r?\n/)
    let hostname: string | null = null
    let port: string | null = null
    for (const line of lines) {
      const [key, ...rest] = line.trim().split(/\s+/)
      if (!key || rest.length === 0) continue
      const value = rest.join(' ')
      if (key.toLowerCase() === 'hostname') hostname = value
      if (key.toLowerCase() === 'port') port = value
    }
    return { hostname, port }
  } catch {
    return { hostname: null, port: null }
  }
}
