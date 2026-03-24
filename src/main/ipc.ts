import { BrowserWindow, ipcMain } from 'electron'
import type { CreateSessionRequest } from '../shared/types'
import { getSettings, setConfigFilePath, updateSettings } from './settings'
import { checkHostsReachability } from './reachability'
import {
  addHostInConfig,
  assignHostGroupInConfig,
  clearHostGroupInConfig,
  convertGroupToSpaceInConfig,
  convertSpaceToGroupInConfig,
  createGroupInConfig,
  deleteHostInConfig,
  deleteGroupInConfig,
  moveGroupInConfig,
  parseSshConfig,
  setHostFavoriteInConfig,
  updateHostSettingsInConfig
} from './ssh-config'
import { SessionManager } from './session'

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
  createSession: 'session:create',
  acceptHostKeyChange: 'session:acceptHostKeyChange',
  writeSessionInput: 'session:input',
  resizeSession: 'session:resize',
  closeSession: 'session:close',
  sessionData: 'session:data',
  sessionExit: 'session:exit',
  sessionHostKeyChanged: 'session:hostKeyChanged'
} as const

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const sessionManager = new SessionManager(
    (sessionId, data) => {
      mainWindow.webContents.send(CHANNELS.sessionData, { sessionId, data })
    },
    (sessionId, code) => {
      mainWindow.webContents.send(CHANNELS.sessionExit, { sessionId, code })
    },
    (event) => {
      mainWindow.webContents.send(CHANNELS.sessionHostKeyChanged, event)
    }
  )

  ipcMain.handle(CHANNELS.getSettings, () => getSettings())

  ipcMain.handle(CHANNELS.setConfigPath, async (_event, configPath: string) => {
    const settings = setConfigFilePath(configPath)
    return parseSshConfig(settings.configFilePath)
  })

  ipcMain.handle(
    CHANNELS.updateSettings,
    async (_event, payload: { configFilePath?: string; scrollbackLines?: number }) => {
      const settings = updateSettings(payload)
      return {
        settings,
        model: await parseSshConfig(settings.configFilePath)
      }
    }
  )

  ipcMain.handle(CHANNELS.getHosts, async () => {
    const settings = getSettings()
    return parseSshConfig(settings.configFilePath)
  })

  ipcMain.handle(
    CHANNELS.checkReachability,
    async (_event, payload: { hosts: Array<{ alias: string; target: string }> }) => {
      return checkHostsReachability(payload.hosts)
    }
  )

  ipcMain.handle(CHANNELS.assignHostGroup, async (_event, payload: { alias: string; groupPath: string }) => {
    const settings = getSettings()
    await assignHostGroupInConfig(settings.configFilePath, payload.alias, payload.groupPath)
    return parseSshConfig(settings.configFilePath)
  })

  ipcMain.handle(CHANNELS.setHostFavorite, async (_event, payload: { alias: string; isFavorite: boolean }) => {
    const settings = getSettings()
    await setHostFavoriteInConfig(settings.configFilePath, payload.alias, payload.isFavorite)
    return parseSshConfig(settings.configFilePath)
  })

  ipcMain.handle(
    CHANNELS.updateHostSettings,
    async (
      _event,
      payload: {
        currentAlias: string
        name: string
        aliases: string[]
        groupPath: string
        isFavorite: boolean
        options: {
          hostName: string
          user: string
          port: string
          identityFile: string
          proxyJump: string
          proxyCommand: string
          identitiesOnly: string
          forwardAgent: string
          compression: string
          connectTimeout: string
          serverAliveInterval: string
          serverAliveCountMax: string
          strictHostKeyChecking: string
          userKnownHostsFile: string
          preferredAuthentications: string
          localForward: string
          remoteForward: string
          logLevel: string
        }
      }
    ) => {
      const settings = getSettings()
      await updateHostSettingsInConfig(settings.configFilePath, payload)
      return parseSshConfig(settings.configFilePath)
    }
  )

  ipcMain.handle(
    CHANNELS.moveGroup,
    async (_event, payload: { sourceGroupPath: string; targetParentGroupPath: string }) => {
      const settings = getSettings()
      await moveGroupInConfig(settings.configFilePath, payload.sourceGroupPath, payload.targetParentGroupPath)
      return parseSshConfig(settings.configFilePath)
    }
  )

  ipcMain.handle(CHANNELS.createGroup, async (_event, payload: { parentPath: string; folderName: string }) => {
    const settings = getSettings()
    await createGroupInConfig(settings.configFilePath, payload.parentPath, payload.folderName)
    return parseSshConfig(settings.configFilePath)
  })

  ipcMain.handle(CHANNELS.deleteGroup, async (_event, payload: { groupPath: string }) => {
    const settings = getSettings()
    await deleteGroupInConfig(settings.configFilePath, payload.groupPath)
    return parseSshConfig(settings.configFilePath)
  })

  ipcMain.handle(
    CHANNELS.convertGroupToSpace,
    async (_event, payload: { groupPath: string; spaceName: string }) => {
      const settings = getSettings()
      await convertGroupToSpaceInConfig(settings.configFilePath, payload.groupPath, payload.spaceName)
      return parseSshConfig(settings.configFilePath)
    }
  )

  ipcMain.handle(CHANNELS.convertSpaceToGroup, async (_event, payload: { groupPath: string }) => {
    const settings = getSettings()
    await convertSpaceToGroupInConfig(settings.configFilePath, payload.groupPath)
    return parseSshConfig(settings.configFilePath)
  })

  ipcMain.handle(CHANNELS.deleteHost, async (_event, payload: { alias: string }) => {
    const settings = getSettings()
    await deleteHostInConfig(settings.configFilePath, payload.alias)
    return parseSshConfig(settings.configFilePath)
  })

  ipcMain.handle(
    CHANNELS.addHost,
    async (
      _event,
      payload: {
        name: string
        aliases: string[]
        groupPath: string
        isFavorite: boolean
        options: {
          hostName: string
          user: string
          port: string
          identityFile: string
          proxyJump: string
          proxyCommand: string
          identitiesOnly: string
          forwardAgent: string
          compression: string
          connectTimeout: string
          serverAliveInterval: string
          serverAliveCountMax: string
          strictHostKeyChecking: string
          userKnownHostsFile: string
          preferredAuthentications: string
          localForward: string
          remoteForward: string
          logLevel: string
        }
      }
    ) => {
      const settings = getSettings()
      await addHostInConfig(settings.configFilePath, payload)
      return parseSshConfig(settings.configFilePath)
    }
  )

  ipcMain.handle(CHANNELS.createSession, (_event, request: CreateSessionRequest) => {
    const settings = getSettings()
    const sessionId = sessionManager.createSession(
      request.alias,
      settings.configFilePath,
      request.cols,
      request.rows
    )
    return { sessionId }
  })

  ipcMain.handle(CHANNELS.writeSessionInput, (_event, payload: { sessionId: string; data: string }) => {
    sessionManager.writeInput(payload.sessionId, payload.data)
  })

  ipcMain.handle(
    CHANNELS.resizeSession,
    (_event, payload: { sessionId: string; cols: number; rows: number }) => {
      sessionManager.resize(payload.sessionId, payload.cols, payload.rows)
    }
  )

  ipcMain.handle(CHANNELS.closeSession, (_event, payload: { sessionId: string }) => {
    sessionManager.close(payload.sessionId)
  })

  ipcMain.handle(CHANNELS.acceptHostKeyChange, (_event, payload: { alias: string }) => {
    const settings = getSettings()
    sessionManager.acceptHostKeyChange(payload.alias, settings.configFilePath)
  })

  ipcMain.handle(CHANNELS.assignHostGroup + ':clear', async (_event, payload: { alias: string }) => {
    const settings = getSettings()
    await clearHostGroupInConfig(settings.configFilePath, payload.alias)
    return parseSshConfig(settings.configFilePath)
  })
}

export { CHANNELS }
