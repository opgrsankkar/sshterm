import type {
  AppSettings,
  CreateSessionRequest,
  HostOptions,
  SessionCreated,
  SshConfigModel
} from './types'

export interface HostEditorPayload {
  name: string
  aliases: string[]
  groupPath: string
  isFavorite: boolean
  options: HostOptions
}

export interface HostUpdatePayload extends HostEditorPayload {
  currentAlias: string
}

export interface SessionHostKeyChangedPayload {
  sessionId: string
  alias: string
  fingerprint: string | null
  knownHostsPath: string | null
  offendingLine: number | null
  message: string
}

export interface SessionAuthenticationFallbackPayload {
  sessionId: string
  alias: string
  message: string
  suggestedPreferredAuthentications: string
  debugSummary: string | null
}

export interface SshtermApi {
  getSettings: () => Promise<AppSettings>
  setConfigPath: (configPath: string) => Promise<SshConfigModel>
  updateSettings: (input: { configFilePath?: string; scrollbackLines?: number }) => Promise<{
    settings: AppSettings
    model: SshConfigModel
  }>
  getHosts: () => Promise<SshConfigModel>
  assignHostGroup: (alias: string, groupPath: string) => Promise<SshConfigModel>
  setHostFavorite: (alias: string, isFavorite: boolean) => Promise<SshConfigModel>
  moveGroup: (sourceGroupPath: string, targetParentGroupPath: string) => Promise<SshConfigModel>
  createGroup: (parentPath: string, folderName: string) => Promise<SshConfigModel>
  deleteGroup: (groupPath: string) => Promise<SshConfigModel>
  convertGroupToSpace: (groupPath: string, spaceName: string) => Promise<SshConfigModel>
  convertSpaceToGroup: (groupPath: string) => Promise<SshConfigModel>
  deleteHost: (alias: string) => Promise<SshConfigModel>
  addHost: (payload: HostEditorPayload) => Promise<SshConfigModel>
  updateHostSettings: (payload: HostUpdatePayload) => Promise<SshConfigModel>
  checkReachability: (
    hosts: Array<{ alias: string; target: string }>
  ) => Promise<Array<{ alias: string; reachable: boolean }>>
  clearHostGroup: (alias: string) => Promise<SshConfigModel>
  createSession: (request: CreateSessionRequest) => Promise<SessionCreated>
  acceptHostKeyChange: (alias: string) => Promise<void>
  writeSessionInput: (sessionId: string, data: string) => Promise<void>
  resizeSession: (sessionId: string, cols: number, rows: number) => Promise<void>
  closeSession: (sessionId: string) => Promise<void>
  onSessionData: (listener: (payload: { sessionId: string; data: string }) => void) => () => void
  onSessionExit: (listener: (payload: { sessionId: string; code: number }) => void) => () => void
  onSessionHostKeyChanged: (listener: (payload: SessionHostKeyChangedPayload) => void) => () => void
  onSessionAuthenticationFallback: (
    listener: (payload: SessionAuthenticationFallbackPayload) => void
  ) => () => void
  onOpenSettings: (listener: () => void) => () => void
  onOpenActiveDeviceSettings: (listener: () => void) => () => void
  onToggleSidebar: (listener: () => void) => () => void
  onRefreshHosts: (listener: () => void) => () => void
  onOpenNewHost: (listener: () => void) => () => void
  onActivateNextTab: (listener: () => void) => () => void
  onActivatePreviousTab: (listener: () => void) => () => void
  onActivateNextSpace: (listener: () => void) => () => void
  onActivatePreviousSpace: (listener: () => void) => () => void
  onOpenHostSearch: (listener: () => void) => () => void
  onOpenTerminalSearch: (listener: (payload: { scope: 'current' | 'all' }) => void) => () => void
  onCloseActiveTab: (listener: () => void) => () => void
}
