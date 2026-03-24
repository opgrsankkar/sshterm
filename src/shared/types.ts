export interface HostOptions {
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

export interface HostEntry {
  alias: string
  aliases: string[]
  pingTarget: string
  isFavorite: boolean
  options: HostOptions
  sourceSpaceName: string | null
  effectiveSpaceName: string
  sourceGroupPath: string | null
  effectiveGroupPath: string | null
  assignmentReason: 'valid-comment' | 'invalid-comment' | 'no-comment' | 'override' | 'space-derived'
}

export interface GroupNode {
  name: string
  path: string
  children: GroupNode[]
  hosts: HostEntry[]
  spaceName: string | null
  effectiveSpaceName: string
}

export interface SpaceDefinition {
  name: string
  rootGroupPath: string
}

export interface SshConfigModel {
  configPath: string
  globalRoot: GroupNode
  unassigned: HostEntry[]
  availableGroups: string[]
  spaces: SpaceDefinition[]
  availableSpaceNames: string[]
}

export interface AppSettings {
  configFilePath: string
  scrollbackLines: number
}

export interface CreateSessionRequest {
  alias: string
  cols: number
  rows: number
}

export interface SessionCreated {
  sessionId: string
}
