import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppSettings, CreateSessionRequest, HostOptions, SessionCreated, SshConfigModel } from '../shared/types'

const CHANNELS = {
  getSettings: 'settings:get',
  setConfigPath: 'settings:setConfigPath',
  updateSettings: 'settings:update',
  getHosts: 'ssh:getHosts',
  assignHostGroup: 'ssh:assignHostGroup',
  setHostFavorite: 'ssh:setHostFavorite',
  moveGroup: 'ssh:moveGroup',
  createGroup: 'ssh:createGroup',
  deleteGroup: 'ssh:deleteGroup',
  convertGroupToSpace: 'ssh:convertGroupToSpace',
  convertSpaceToGroup: 'ssh:convertSpaceToGroup',
  deleteHost: 'ssh:deleteHost',
  addHost: 'ssh:addHost',
  updateHostSettings: 'ssh:updateHostSettings',
  checkReachability: 'ssh:checkReachability',
  clearHostGroup: 'ssh:assignHostGroup:clear',
  createSession: 'session:create',
  acceptHostKeyChange: 'session:acceptHostKeyChange',
  writeSessionInput: 'session:input',
  resizeSession: 'session:resize',
  closeSession: 'session:close',
  sessionData: 'session:data',
  sessionExit: 'session:exit',
  sessionHostKeyChanged: 'session:hostKeyChanged',
  openSettings: 'ui:openSettings',
  openActiveDeviceSettings: 'ui:openActiveDeviceSettings',
  toggleSidebar: 'ui:toggleSidebar'
} as const

// Custom APIs for renderer
const api = {
  getSettings: (): Promise<AppSettings> => electronAPI.ipcRenderer.invoke(CHANNELS.getSettings),
  setConfigPath: (configPath: string): Promise<SshConfigModel> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.setConfigPath, configPath),
  updateSettings: (
    input: {
      configFilePath?: string
      scrollbackLines?: number
    }
  ): Promise<{
    settings: AppSettings
    model: SshConfigModel
  }> => electronAPI.ipcRenderer.invoke(CHANNELS.updateSettings, input),
  getHosts: (): Promise<SshConfigModel> => electronAPI.ipcRenderer.invoke(CHANNELS.getHosts),
  assignHostGroup: (alias: string, groupPath: string): Promise<SshConfigModel> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.assignHostGroup, { alias, groupPath }),
  setHostFavorite: (alias: string, isFavorite: boolean): Promise<SshConfigModel> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.setHostFavorite, { alias, isFavorite }),
  moveGroup: (sourceGroupPath: string, targetParentGroupPath: string): Promise<SshConfigModel> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.moveGroup, { sourceGroupPath, targetParentGroupPath }),
  createGroup: (parentPath: string, folderName: string): Promise<SshConfigModel> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.createGroup, { parentPath, folderName }),
  deleteGroup: (groupPath: string): Promise<SshConfigModel> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.deleteGroup, { groupPath }),
  convertGroupToSpace: (groupPath: string, spaceName: string): Promise<SshConfigModel> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.convertGroupToSpace, { groupPath, spaceName }),
  convertSpaceToGroup: (groupPath: string): Promise<SshConfigModel> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.convertSpaceToGroup, { groupPath }),
  deleteHost: (alias: string): Promise<SshConfigModel> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.deleteHost, { alias }),
  addHost: (
    payload: {
      name: string
      aliases: string[]
      groupPath: string
      isFavorite: boolean
      options: HostOptions
    }
  ): Promise<SshConfigModel> => electronAPI.ipcRenderer.invoke(CHANNELS.addHost, payload),
  updateHostSettings: (
    payload: {
      currentAlias: string
      name: string
      aliases: string[]
      groupPath: string
      isFavorite: boolean
      options: HostOptions
    }
  ): Promise<SshConfigModel> => electronAPI.ipcRenderer.invoke(CHANNELS.updateHostSettings, payload),
  checkReachability: (hosts: Array<{ alias: string; target: string }>): Promise<Array<{ alias: string; reachable: boolean }>> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.checkReachability, { hosts }),
  clearHostGroup: (alias: string): Promise<SshConfigModel> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.clearHostGroup, { alias }),
  createSession: (request: CreateSessionRequest): Promise<SessionCreated> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.createSession, request),
  acceptHostKeyChange: (alias: string): Promise<void> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.acceptHostKeyChange, { alias }),
  writeSessionInput: (sessionId: string, data: string): Promise<void> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.writeSessionInput, { sessionId, data }),
  resizeSession: (sessionId: string, cols: number, rows: number): Promise<void> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.resizeSession, { sessionId, cols, rows }),
  closeSession: (sessionId: string): Promise<void> =>
    electronAPI.ipcRenderer.invoke(CHANNELS.closeSession, { sessionId }),
  onSessionData: (listener: (payload: { sessionId: string; data: string }) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: { sessionId: string; data: string }): void => {
      listener(payload)
    }
    electronAPI.ipcRenderer.on(CHANNELS.sessionData, wrapped)
    return () => electronAPI.ipcRenderer.removeListener(CHANNELS.sessionData, wrapped)
  },
  onSessionExit: (listener: (payload: { sessionId: string; code: number }) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: { sessionId: string; code: number }): void => {
      listener(payload)
    }
    electronAPI.ipcRenderer.on(CHANNELS.sessionExit, wrapped)
    return () => electronAPI.ipcRenderer.removeListener(CHANNELS.sessionExit, wrapped)
  },
  onSessionHostKeyChanged: (
    listener: (payload: {
      sessionId: string
      alias: string
      fingerprint: string | null
      knownHostsPath: string | null
      offendingLine: number | null
      message: string
    }) => void
  ): (() => void) => {
    const wrapped = (
      _event: unknown,
      payload: {
        sessionId: string
        alias: string
        fingerprint: string | null
        knownHostsPath: string | null
        offendingLine: number | null
        message: string
      }
    ): void => {
      listener(payload)
    }
    electronAPI.ipcRenderer.on(CHANNELS.sessionHostKeyChanged, wrapped)
    return () => electronAPI.ipcRenderer.removeListener(CHANNELS.sessionHostKeyChanged, wrapped)
  },
  onOpenSettings: (listener: () => void): (() => void) => {
    const wrapped = (): void => {
      listener()
    }
    electronAPI.ipcRenderer.on(CHANNELS.openSettings, wrapped)
    return () => electronAPI.ipcRenderer.removeListener(CHANNELS.openSettings, wrapped)
  },
  onOpenActiveDeviceSettings: (listener: () => void): (() => void) => {
    const wrapped = (): void => {
      listener()
    }
    electronAPI.ipcRenderer.on(CHANNELS.openActiveDeviceSettings, wrapped)
    return () => electronAPI.ipcRenderer.removeListener(CHANNELS.openActiveDeviceSettings, wrapped)
  },
  onToggleSidebar: (listener: () => void): (() => void) => {
    const wrapped = (): void => {
      listener()
    }
    electronAPI.ipcRenderer.on(CHANNELS.toggleSidebar, wrapped)
    return () => electronAPI.ipcRenderer.removeListener(CHANNELS.toggleSidebar, wrapped)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
