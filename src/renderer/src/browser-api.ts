import type {
  HostEditorPayload,
  HostUpdatePayload,
  SessionAuthenticationFallbackPayload,
  SessionHostKeyChangedPayload,
  SshtermApi
} from '../../shared/api'
import type {
  AppSettings,
  CreateSessionRequest,
  SessionCreated,
  SshConfigModel
} from '../../shared/types'

interface ApiResponse<T> {
  ok: boolean
  result?: T
  error?: string
}

interface SocketResponse {
  type: 'response'
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

interface SocketEvent {
  type: 'event'
  event: string
  payload: unknown
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

async function invokeHttp<T>(method: string, params: unknown = {}): Promise<T> {
  const response = await fetch('/api/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params })
  })
  const payload = (await response.json()) as ApiResponse<T>
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}`)
  }
  return payload.result as T
}

class SessionSocket {
  private socket: WebSocket | null = null
  private connecting: Promise<WebSocket> | null = null
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>()

  request<T>(method: string, params: unknown): Promise<T> {
    return this.connect().then(
      (socket) =>
        new Promise<T>((resolve, reject) => {
          const id = this.nextRequestId++
          this.pending.set(id, {
            resolve: (value) => resolve(value as T),
            reject
          })
          socket.send(JSON.stringify({ type: 'invoke', id, method, params }))
        })
    )
  }

  async notify(method: string, params: unknown): Promise<void> {
    const socket = await this.connect()
    socket.send(JSON.stringify({ type: 'notify', method, params }))
  }

  on<T>(event: string, listener: (payload: T) => void): () => void {
    const wrapped = (payload: unknown): void => listener(payload as T)
    const eventListeners = this.listeners.get(event) ?? new Set<(payload: unknown) => void>()
    eventListeners.add(wrapped)
    this.listeners.set(event, eventListeners)
    void this.connect().catch(() => undefined)
    return () => eventListeners.delete(wrapped)
  }

  private connect(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.socket)
    }
    if (this.connecting) return this.connecting

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/ws`)
    this.socket = socket
    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(socket), { once: true })
      socket.addEventListener(
        'error',
        () => reject(new Error('Could not connect to the local sshterm service.')),
        { once: true }
      )
    }).finally(() => {
      this.connecting = null
    })

    socket.addEventListener('message', (event) => this.handleMessage(event.data))
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null
      const error = new Error('The local sshterm service disconnected.')
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    })

    return this.connecting
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return

    let message: SocketResponse | SocketEvent
    try {
      message = JSON.parse(raw) as SocketResponse | SocketEvent
    } catch {
      return
    }

    if (message.type === 'response') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.ok) {
        pending.resolve(message.result)
      } else {
        pending.reject(new Error(message.error ?? 'Session request failed.'))
      }
      return
    }

    for (const listener of this.listeners.get(message.event) ?? []) {
      listener(message.payload)
    }
  }
}

type UiEventName =
  | 'openSettings'
  | 'openActiveDeviceSettings'
  | 'toggleSidebar'
  | 'refreshHosts'
  | 'openNewHost'
  | 'activateNextTab'
  | 'activatePreviousTab'
  | 'activateNextSpace'
  | 'activatePreviousSpace'
  | 'openHostSearch'
  | 'openTerminalSearch'
  | 'closeActiveTab'

class UiShortcuts {
  private readonly listeners = new Map<UiEventName, Set<(payload: unknown) => void>>()

  constructor() {
    window.addEventListener('keydown', (event) => this.handleKeyDown(event))
  }

  on<T>(name: UiEventName, listener: (payload: T) => void): () => void {
    const wrapped = (payload: unknown): void => listener(payload as T)
    const listeners = this.listeners.get(name) ?? new Set<(payload: unknown) => void>()
    listeners.add(wrapped)
    this.listeners.set(name, listeners)
    return () => listeners.delete(wrapped)
  }

  private emit(name: UiEventName, payload?: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) listener(payload)
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.ctrlKey && event.key === 'Tab') {
      event.preventDefault()
      this.emit(event.shiftKey ? 'activatePreviousTab' : 'activateNextTab')
      return
    }
    if (event.altKey && event.key === 'Tab') {
      event.preventDefault()
      this.emit(event.shiftKey ? 'activatePreviousSpace' : 'activateNextSpace')
      return
    }

    const commandOrControl = /Mac|iPhone|iPad/.test(navigator.platform)
      ? event.metaKey
      : event.ctrlKey
    if (!commandOrControl) return

    const key = event.key.toLowerCase()
    let eventName: UiEventName | null = null
    let payload: unknown
    if (event.key === ',') eventName = event.shiftKey ? 'openActiveDeviceSettings' : 'openSettings'
    if (key === 's') eventName = 'toggleSidebar'
    if (key === 't') eventName = 'openHostSearch'
    if (key === 'f') {
      eventName = 'openTerminalSearch'
      payload = { scope: event.shiftKey ? 'all' : 'current' }
    }
    if (key === 'w') eventName = 'closeActiveTab'
    if (key === 'r') eventName = 'refreshHosts'
    if (key === 'n') eventName = 'openNewHost'

    if (eventName) {
      event.preventDefault()
      this.emit(eventName, payload)
    }
  }
}

export function installBrowserApi(): void {
  const sessions = new SessionSocket()
  const ui = new UiShortcuts()
  const onUi = (name: UiEventName, listener: () => void): (() => void) =>
    ui.on<undefined>(name, listener)

  const api: SshtermApi = {
    getSettings: () => invokeHttp<AppSettings>('getSettings'),
    setConfigPath: (configPath) => invokeHttp<SshConfigModel>('setConfigPath', { configPath }),
    updateSettings: (input) =>
      invokeHttp<{ settings: AppSettings; model: SshConfigModel }>('updateSettings', input),
    getHosts: () => invokeHttp<SshConfigModel>('getHosts'),
    assignHostGroup: (alias, groupPath) =>
      invokeHttp<SshConfigModel>('assignHostGroup', { alias, groupPath }),
    setHostFavorite: (alias, isFavorite) =>
      invokeHttp<SshConfigModel>('setHostFavorite', { alias, isFavorite }),
    moveGroup: (sourceGroupPath, targetParentGroupPath) =>
      invokeHttp<SshConfigModel>('moveGroup', { sourceGroupPath, targetParentGroupPath }),
    createGroup: (parentPath, folderName) =>
      invokeHttp<SshConfigModel>('createGroup', { parentPath, folderName }),
    deleteGroup: (groupPath) => invokeHttp<SshConfigModel>('deleteGroup', { groupPath }),
    convertGroupToSpace: (groupPath, spaceName) =>
      invokeHttp<SshConfigModel>('convertGroupToSpace', { groupPath, spaceName }),
    convertSpaceToGroup: (groupPath) =>
      invokeHttp<SshConfigModel>('convertSpaceToGroup', { groupPath }),
    deleteHost: (alias) => invokeHttp<SshConfigModel>('deleteHost', { alias }),
    addHost: (payload: HostEditorPayload) => invokeHttp<SshConfigModel>('addHost', payload),
    updateHostSettings: (payload: HostUpdatePayload) =>
      invokeHttp<SshConfigModel>('updateHostSettings', payload),
    checkReachability: (hosts) => invokeHttp('checkReachability', { hosts }),
    clearHostGroup: (alias) => invokeHttp<SshConfigModel>('clearHostGroup', { alias }),
    createSession: (request: CreateSessionRequest) =>
      sessions.request<SessionCreated>('createSession', request),
    acceptHostKeyChange: (alias) => sessions.request<void>('acceptHostKeyChange', { alias }),
    writeSessionInput: (sessionId, data) =>
      sessions.notify('writeSessionInput', { sessionId, data }),
    resizeSession: (sessionId, cols, rows) =>
      sessions.notify('resizeSession', { sessionId, cols, rows }),
    closeSession: (sessionId) => sessions.notify('closeSession', { sessionId }),
    onSessionData: (listener) => sessions.on('sessionData', listener),
    onSessionExit: (listener) => sessions.on('sessionExit', listener),
    onSessionHostKeyChanged: (listener: (payload: SessionHostKeyChangedPayload) => void) =>
      sessions.on('sessionHostKeyChanged', listener),
    onSessionAuthenticationFallback: (
      listener: (payload: SessionAuthenticationFallbackPayload) => void
    ) => sessions.on('sessionAuthenticationFallback', listener),
    onOpenSettings: (listener) => onUi('openSettings', listener),
    onOpenActiveDeviceSettings: (listener) => onUi('openActiveDeviceSettings', listener),
    onToggleSidebar: (listener) => onUi('toggleSidebar', listener),
    onRefreshHosts: (listener) => onUi('refreshHosts', listener),
    onOpenNewHost: (listener) => onUi('openNewHost', listener),
    onActivateNextTab: (listener) => onUi('activateNextTab', listener),
    onActivatePreviousTab: (listener) => onUi('activatePreviousTab', listener),
    onActivateNextSpace: (listener) => onUi('activateNextSpace', listener),
    onActivatePreviousSpace: (listener) => onUi('activatePreviousSpace', listener),
    onOpenHostSearch: (listener) => onUi('openHostSearch', listener),
    onOpenTerminalSearch: (listener) => ui.on('openTerminalSearch', listener),
    onCloseActiveTab: (listener) => onUi('closeActiveTab', listener)
  }

  window.api = api
}
