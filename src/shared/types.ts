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
  sourceGroupPath: string | null
  effectiveGroupPath: string | null
  assignmentReason: 'valid-comment' | 'invalid-comment' | 'no-comment' | 'override'
}

export interface GroupNode {
  name: string
  path: string
  children: GroupNode[]
  hosts: HostEntry[]
}

export interface SshConfigModel {
  configPath: string
  globalRoot: GroupNode
  unassigned: HostEntry[]
  availableGroups: string[]
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
