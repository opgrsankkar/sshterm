import fs from 'node:fs/promises'
import type { GroupNode, HostEntry, HostOptions, SpaceDefinition, SshConfigModel } from '../shared/types'

const GROUP_COMMENT_REGEX = /^#\s*x-sshterm-group:\s*(.+?)\s*$/i
const GROUP_DIR_REGEX = /^#\s*x-sshterm-dir:\s*(.+?)\s*$/i
const SPACE_COMMENT_REGEX = /^#\s*x-sshterm-space:\s*(.+?)\s*$/i
const FAVORITE_COMMENT_REGEX = /^#\s*x-sshterm-favorites:\s*(true|false)\s*$/i
const MANAGED_DIRS_START = '# x-sshterm-managed-dirs:start'
const MANAGED_DIRS_END = '# x-sshterm-managed-dirs:end'
const HOST_REGEX = /^\s*Host\s+(.+)$/i

const HOST_OPTION_KEYS = {
  hostName: 'HostName',
  user: 'User',
  port: 'Port',
  identityFile: 'IdentityFile',
  proxyJump: 'ProxyJump',
  proxyCommand: 'ProxyCommand',
  identitiesOnly: 'IdentitiesOnly',
  forwardAgent: 'ForwardAgent',
  compression: 'Compression',
  connectTimeout: 'ConnectTimeout',
  serverAliveInterval: 'ServerAliveInterval',
  serverAliveCountMax: 'ServerAliveCountMax',
  strictHostKeyChecking: 'StrictHostKeyChecking',
  userKnownHostsFile: 'UserKnownHostsFile',
  preferredAuthentications: 'PreferredAuthentications',
  localForward: 'LocalForward',
  remoteForward: 'RemoteForward',
  logLevel: 'LogLevel'
} as const

const CONFIG_KEY_TO_OPTION_KEY = Object.entries(HOST_OPTION_KEYS).reduce<Record<string, keyof HostOptions>>(
  (acc, [key, value]) => {
    acc[value.toLowerCase()] = key as keyof HostOptions
    return acc
  },
  {}
)

function createEmptyHostOptions(): HostOptions {
  return {
    hostName: '',
    user: '',
    port: '',
    identityFile: '',
    proxyJump: '',
    proxyCommand: '',
    identitiesOnly: '',
    forwardAgent: '',
    compression: '',
    connectTimeout: '',
    serverAliveInterval: '',
    serverAliveCountMax: '',
    strictHostKeyChecking: '',
    userKnownHostsFile: '',
    preferredAuthentications: '',
    localForward: '',
    remoteForward: '',
    logLevel: ''
  }
}

function isConcreteAlias(alias: string): boolean {
  return alias.length > 0 && !alias.includes('*') && !alias.includes('?') && !alias.startsWith('!')
}

function normalizeGroupPath(raw: string | null): string | null {
  if (!raw) return null
  const segments = raw
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (segments.length === 0) return null
  if (segments[0] !== 'Global') return null
  return segments.join('/')
}

function normalizeSpaceName(raw: string | null): string | null {
  if (!raw) return null
  const name = raw.trim()
  if (!name || name.toLowerCase() === 'default') return null
  return name
}

function createGroupNode(name: string, path: string): GroupNode {
  return {
    name,
    path,
    children: [],
    hosts: [],
    spaceName: null,
    effectiveSpaceName: 'Default'
  }
}

function insertHost(globalRoot: GroupNode, host: HostEntry, groupPath: string): void {
  const segments = groupPath.split('/').filter(Boolean)
  let cursor = globalRoot

  for (let index = 1; index < segments.length; index++) {
    const name = segments[index]
    const path = segments.slice(0, index + 1).join('/')
    let child = cursor.children.find((node) => node.path === path)
    if (!child) {
      child = createGroupNode(name, path)
      cursor.children.push(child)
    }
    cursor = child
  }

  cursor.hosts.push(host)
}

function ensureGroupPath(globalRoot: GroupNode, groupPath: string): void {
  const segments = groupPath.split('/').filter(Boolean)
  let cursor = globalRoot

  for (let index = 1; index < segments.length; index++) {
    const name = segments[index]
    const path = segments.slice(0, index + 1).join('/')
    let child = cursor.children.find((node) => node.path === path)
    if (!child) {
      child = createGroupNode(name, path)
      cursor.children.push(child)
    }
    cursor = child
  }
}

function findGroupNode(root: GroupNode, groupPath: string): GroupNode | null {
  if (root.path === groupPath) return root

  for (const child of root.children) {
    const found = findGroupNode(child, groupPath)
    if (found) return found
  }

  return null
}

function sortTree(node: GroupNode): void {
  node.children.sort((left, right) => left.name.localeCompare(right.name))
  node.hosts.sort((left, right) => left.alias.localeCompare(right.alias))
  node.children.forEach(sortTree)
}

function findPrimaryAlias(line: string): string | null {
  const hostMatch = line.match(HOST_REGEX)
  if (!hostMatch) return null
  const aliases = hostMatch[1].split(/\s+/).map((alias) => alias.trim())
  const primaryAlias = aliases[0]
  if (!primaryAlias || !isConcreteAlias(primaryAlias)) return null
  return primaryAlias
}

function buildManagedDirBlock(directories: Array<{ path: string; spaceName: string | null }>): string[] {
  if (directories.length === 0) return []

  const sortedDirectories = [...directories].sort((left, right) => left.path.localeCompare(right.path))
  return [
    MANAGED_DIRS_START,
    ...sortedDirectories.flatMap((entry) => {
      const lines: string[] = []
      if (entry.spaceName) {
        lines.push(`# x-sshterm-space: ${entry.spaceName}`)
      }
      lines.push(`# x-sshterm-dir: ${entry.path}`)
      return lines
    }),
    MANAGED_DIRS_END
  ]
}

function collectManagedDirectories(lines: string[]): Map<string, string | null> {
  const directories = new Map<string, string | null>()
  let pendingSpaceName: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()

    const spaceMatch = trimmed.match(SPACE_COMMENT_REGEX)
    if (spaceMatch) {
      pendingSpaceName = normalizeSpaceName(spaceMatch[1])
      continue
    }

    const dirMatch = trimmed.match(GROUP_DIR_REGEX)
    if (dirMatch) {
      const normalizedDir = normalizeGroupPath(dirMatch[1])
      if (normalizedDir && normalizedDir !== 'Global') {
        directories.set(normalizedDir, pendingSpaceName)
      }
      pendingSpaceName = null
      continue
    }

    if (trimmed && !trimmed.startsWith('#')) {
      pendingSpaceName = null
    }
  }

  return directories
}

function findHostCommentBlockStart(lines: string[], hostIndex: number): number {
  let index = hostIndex - 1
  while (index >= 0) {
    const trimmed = lines[index].trim()
    if (!trimmed.startsWith('#')) break
    index -= 1
  }
  return index + 1
}

function findHostCommentLineIndex(lines: string[], hostIndex: number, matcher: RegExp): number {
  const start = findHostCommentBlockStart(lines, hostIndex)
  for (let index = start; index < hostIndex; index++) {
    if (matcher.test(lines[index].trim())) {
      return index
    }
  }
  return -1
}

function findHostRange(lines: string[], alias: string): { hostIndex: number; blockEnd: number } {
  const hostIndex = lines.findIndex((line) => findPrimaryAlias(line) === alias)
  if (hostIndex < 0) {
    throw new Error(`Host alias not found in config: ${alias}`)
  }

  let blockEnd = lines.length
  for (let index = hostIndex + 1; index < lines.length; index++) {
    if (HOST_REGEX.test(lines[index])) {
      blockEnd = index
      break
    }
  }

  return { hostIndex, blockEnd }
}

function setManagedComment(
  lines: string[],
  hostIndex: number,
  matcher: RegExp,
  value: string | null
): number {
  const existingCommentLine = findHostCommentLineIndex(lines, hostIndex, matcher)
  if (value) {
    if (existingCommentLine >= 0) {
      lines[existingCommentLine] = value
      return hostIndex
    }
    lines.splice(hostIndex, 0, value)
    return hostIndex + 1
  }

  if (existingCommentLine >= 0) {
    lines.splice(existingCommentLine, 1)
    return hostIndex - 1
  }

  return hostIndex
}

function buildOptionLines(options: HostOptions, indent: string): string[] {
  const optionLines: string[] = []
  for (const [optionKey, configKey] of Object.entries(HOST_OPTION_KEYS) as Array<
    [keyof HostOptions, string]
  >) {
    const value = options[optionKey].trim()
    if (!value) continue
    optionLines.push(`${indent}${configKey} ${value}`)
  }
  return optionLines
}

function findManagedDirsStart(lines: string[]): number {
  const index = lines.findIndex((line) => line.trim() === MANAGED_DIRS_START)
  return index >= 0 ? index : lines.length
}

function rewriteManagedDirBlock(lines: string[], directories: Map<string, string | null>): string[] {
  const startIndex = lines.findIndex((line) => line.trim() === MANAGED_DIRS_START)
  const endIndex = lines.findIndex((line) => line.trim() === MANAGED_DIRS_END)
  const block = buildManagedDirBlock(
    Array.from(directories.entries()).map(([path, spaceName]) => ({ path, spaceName }))
  )

  if (startIndex >= 0 && endIndex >= startIndex) {
    const next = [...lines.slice(0, startIndex), ...block, ...lines.slice(endIndex + 1)]
    return next
  }

  if (block.length === 0) {
    return lines
  }

  const next = [...lines]
  if (next.length > 0 && next[next.length - 1].trim().length !== 0) {
    next.push('')
  }
  next.push(...block)
  return next
}

async function readConfigLines(configPath: string): Promise<string[]> {
  const content = await fs.readFile(configPath, 'utf8')
  return content.split(/\r?\n/)
}

async function writeConfigLines(configPath: string, lines: string[]): Promise<void> {
  await fs.writeFile(configPath, `${lines.join('\n')}\n`, 'utf8')
}

export async function parseSshConfig(configPath: string): Promise<SshConfigModel> {
  const lines = await readConfigLines(configPath)

  const parsedHosts = new Map<string, HostEntry>()
  const directoryGroups = collectManagedDirectories(lines)
  let activeCommentGroup: string | null = null
  let activeCommentSpace: string | null = null
  let activeFavorite = false

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    const trimmed = line.trim()

    const spaceMatch = trimmed.match(SPACE_COMMENT_REGEX)
    if (spaceMatch) {
      activeCommentSpace = normalizeSpaceName(spaceMatch[1])
      continue
    }

    const dirMatch = trimmed.match(GROUP_DIR_REGEX)
    if (dirMatch) {
      activeCommentSpace = null
      continue
    }

    const commentMatch = trimmed.match(GROUP_COMMENT_REGEX)
    if (commentMatch) {
      activeCommentGroup = commentMatch[1]
      continue
    }

    const favoriteMatch = trimmed.match(FAVORITE_COMMENT_REGEX)
    if (favoriteMatch) {
      activeFavorite = favoriteMatch[1].toLowerCase() === 'true'
      continue
    }

    const hostMatch = line.match(HOST_REGEX)
    if (!hostMatch) continue

    const aliases = hostMatch[1].split(/\s+/).map((alias) => alias.trim()).filter(Boolean)
    const primaryAlias = aliases[0]
    if (!primaryAlias || !isConcreteAlias(primaryAlias) || parsedHosts.has(primaryAlias)) continue

    let pingTarget = primaryAlias
    const options = createEmptyHostOptions()
    for (let lookAhead = lineIndex + 1; lookAhead < lines.length; lookAhead++) {
      if (HOST_REGEX.test(lines[lookAhead])) break

      const trimmedLookAhead = lines[lookAhead].trim()
      if (!trimmedLookAhead || trimmedLookAhead.startsWith('#')) {
        continue
      }

      const optionMatch = trimmedLookAhead.match(/^([A-Za-z][A-Za-z0-9]*)\s+(.+)$/)
      if (!optionMatch) {
        continue
      }

      if (optionMatch[1].toLowerCase() === 'hostname') {
        const candidate = optionMatch[2].split(/\s+/)[0]?.trim()
        if (candidate) {
          pingTarget = candidate
        }
      }

      const optionKey = CONFIG_KEY_TO_OPTION_KEY[optionMatch[1].toLowerCase()]
      if (!optionKey) {
        continue
      }

      options[optionKey] = optionMatch[2].trim()
    }

    const sourceGroupPath = normalizeGroupPath(activeCommentGroup)
    const sourceSpaceName = normalizeSpaceName(activeCommentSpace)
    const entry: HostEntry = {
      alias: primaryAlias,
      aliases,
      pingTarget,
      isFavorite: activeFavorite,
      options,
      sourceSpaceName,
      effectiveSpaceName: sourceSpaceName ?? 'Default',
      sourceGroupPath,
      effectiveGroupPath: sourceGroupPath,
      assignmentReason: sourceGroupPath ? 'valid-comment' : sourceSpaceName ? 'space-derived' : activeCommentGroup ? 'invalid-comment' : 'no-comment'
    }
    parsedHosts.set(primaryAlias, entry)
    activeCommentGroup = null
    activeCommentSpace = null
    activeFavorite = false
  }

  const globalRoot = createGroupNode('Global', 'Global')

  const unassigned: HostEntry[] = []

  for (const groupPath of directoryGroups.keys()) {
    ensureGroupPath(globalRoot, groupPath)
  }

  for (const [groupPath, spaceName] of directoryGroups.entries()) {
    if (!spaceName) continue
    const node = findGroupNode(globalRoot, groupPath)
    if (node) {
      node.spaceName = spaceName
    }
  }

  const spaces: SpaceDefinition[] = []
  for (const [groupPath, spaceName] of directoryGroups.entries()) {
    if (!spaceName) continue
    const node = findGroupNode(globalRoot, groupPath)
    if (!node) continue
    spaces.push({
      name: spaceName,
      rootGroupPath: groupPath
    })
  }

  for (const host of parsedHosts.values()) {
    if (!host.effectiveGroupPath) {
      host.effectiveSpaceName = host.sourceSpaceName ?? 'Default'
      unassigned.push(host)
      continue
    }
    insertHost(globalRoot, host, host.effectiveGroupPath)
  }

  const applyEffectiveSpace = (node: GroupNode, parentSpaceName: string): void => {
    const nodeSpaceName = node.spaceName ?? parentSpaceName
    node.effectiveSpaceName = nodeSpaceName

    for (const host of node.hosts) {
      host.effectiveSpaceName = host.sourceSpaceName ?? nodeSpaceName
    }

    for (const child of node.children) {
      applyEffectiveSpace(child, nodeSpaceName)
    }
  }

  applyEffectiveSpace(globalRoot, 'Default')

  sortTree(globalRoot)
  unassigned.sort((left, right) => left.alias.localeCompare(right.alias))

  const availableGroups = new Set<string>(['Global'])
  const collect = (node: GroupNode): void => {
    availableGroups.add(node.path)
    node.children.forEach(collect)
  }
  collect(globalRoot)

  const availableSpaceNames = Array.from(
    new Set(['Default', ...spaces.map((space) => space.name)])
  ).sort((left, right) => left.localeCompare(right))

  return {
    configPath,
    globalRoot,
    unassigned,
    availableGroups: Array.from(availableGroups).sort((left, right) => left.localeCompare(right)),
    spaces: spaces.sort((left, right) => left.name.localeCompare(right.name) || left.rootGroupPath.localeCompare(right.rootGroupPath)),
    availableSpaceNames
  }
}

export async function assignHostGroupInConfig(
  configPath: string,
  alias: string,
  groupPath: string
): Promise<void> {
  const normalized = normalizeGroupPath(groupPath)
  if (!normalized) {
    throw new Error('Group path must start with Global.')
  }

  const lines = await readConfigLines(configPath)
  const hostIndex = lines.findIndex((line) => findPrimaryAlias(line) === alias)
  if (hostIndex < 0) {
    throw new Error(`Host alias not found in config: ${alias}`)
  }

  const newComment = `# x-sshterm-group: ${normalized}`
  const existingCommentLine = findHostCommentLineIndex(lines, hostIndex, GROUP_COMMENT_REGEX)

  if (existingCommentLine >= 0) {
    lines[existingCommentLine] = newComment
  } else {
    lines.splice(hostIndex, 0, newComment)
  }

  await writeConfigLines(configPath, lines)
}

export async function clearHostGroupInConfig(configPath: string, alias: string): Promise<void> {
  const lines = await readConfigLines(configPath)
  const hostIndex = lines.findIndex((line) => findPrimaryAlias(line) === alias)
  if (hostIndex < 0) {
    throw new Error(`Host alias not found in config: ${alias}`)
  }

  const existingCommentLine = findHostCommentLineIndex(lines, hostIndex, GROUP_COMMENT_REGEX)
  if (existingCommentLine >= 0) {
    lines.splice(existingCommentLine, 1)
    await writeConfigLines(configPath, lines)
  }
}

export async function setHostFavoriteInConfig(
  configPath: string,
  alias: string,
  isFavorite: boolean
): Promise<void> {
  const lines = await readConfigLines(configPath)
  const hostIndex = lines.findIndex((line) => findPrimaryAlias(line) === alias)
  if (hostIndex < 0) {
    throw new Error(`Host alias not found in config: ${alias}`)
  }

  const existingFavoriteCommentLine = findHostCommentLineIndex(lines, hostIndex, FAVORITE_COMMENT_REGEX)
  const favoriteComment = '# x-sshterm-favorites: true'

  if (isFavorite) {
    if (existingFavoriteCommentLine >= 0) {
      lines[existingFavoriteCommentLine] = favoriteComment
    } else {
      lines.splice(hostIndex, 0, favoriteComment)
    }
    await writeConfigLines(configPath, lines)
    return
  }

  if (existingFavoriteCommentLine >= 0) {
    lines.splice(existingFavoriteCommentLine, 1)
    await writeConfigLines(configPath, lines)
  }
}

export async function addHostInConfig(
  configPath: string,
  payload: {
    name: string
    aliases: string[]
    groupPath: string
    isFavorite: boolean
    options: HostOptions
  }
): Promise<void> {
  const name = payload.name.trim()
  if (!name) {
    throw new Error('Name is required.')
  }

  const normalizedAliases = Array.from(
    new Set(
      payload.aliases
        .map((alias) => alias.trim())
        .filter((alias) => alias.length > 0 && alias !== name)
    )
  )

  const lines = await readConfigLines(configPath)
  const existingAliases = new Set<string>()
  for (const line of lines) {
    const match = line.match(HOST_REGEX)
    if (!match) continue
    const aliases = match[1].split(/\s+/).map((alias) => alias.trim()).filter(Boolean)
    aliases.forEach((alias) => existingAliases.add(alias))
  }

  const requestedAliases = [name, ...normalizedAliases]
  const duplicateAlias = requestedAliases.find((alias) => existingAliases.has(alias))
  if (duplicateAlias) {
    throw new Error(`Host alias already exists: ${duplicateAlias}`)
  }

  const insertionIndex = findManagedDirsStart(lines)
  const normalizedGroupPath = normalizeGroupPath(payload.groupPath)
  const hostBlock: string[] = []

  if (insertionIndex > 0 && lines[insertionIndex - 1].trim().length !== 0) {
    hostBlock.push('')
  }

  if (normalizedGroupPath && normalizedGroupPath !== 'Global') {
    hostBlock.push(`# x-sshterm-group: ${normalizedGroupPath}`)
  }

  if (payload.isFavorite) {
    hostBlock.push('# x-sshterm-favorites: true')
  }

  hostBlock.push(`Host ${requestedAliases.join(' ')}`)
  hostBlock.push(...buildOptionLines(payload.options, '  '))

  lines.splice(insertionIndex, 0, ...hostBlock)
  await writeConfigLines(configPath, lines)
}

export async function deleteHostInConfig(configPath: string, alias: string): Promise<void> {
  const lines = await readConfigLines(configPath)
  let { hostIndex } = findHostRange(lines, alias)

  const removableManagedCommentIndexes = [
    findHostCommentLineIndex(lines, hostIndex, GROUP_COMMENT_REGEX),
    findHostCommentLineIndex(lines, hostIndex, SPACE_COMMENT_REGEX),
    findHostCommentLineIndex(lines, hostIndex, FAVORITE_COMMENT_REGEX)
  ]
    .filter((index) => index >= 0)
    .sort((left, right) => right - left)

  for (const index of removableManagedCommentIndexes) {
    lines.splice(index, 1)
    if (index < hostIndex) {
      hostIndex -= 1
    }
  }

  let blockEnd = lines.length
  for (let index = hostIndex + 1; index < lines.length; index++) {
    if (HOST_REGEX.test(lines[index])) {
      blockEnd = index
      break
    }
  }

  lines.splice(hostIndex, blockEnd - hostIndex)

  if (hostIndex > 0 && hostIndex < lines.length && lines[hostIndex - 1].trim() === '' && lines[hostIndex].trim() === '') {
    lines.splice(hostIndex, 1)
  }

  await writeConfigLines(configPath, lines)
}

export async function updateHostSettingsInConfig(
  configPath: string,
  payload: {
    currentAlias: string
    name: string
    aliases: string[]
    groupPath: string
    isFavorite: boolean
    options: HostOptions
  }
): Promise<void> {
  const name = payload.name.trim()
  if (!name) {
    throw new Error('Name is required.')
  }

  const normalizedAliases = Array.from(
    new Set(
      payload.aliases
        .map((alias) => alias.trim())
        .filter((alias) => alias.length > 0 && alias !== name)
    )
  )

  const lines = await readConfigLines(configPath)
  const { hostIndex, blockEnd } = findHostRange(lines, payload.currentAlias)
  const blockLines = lines.slice(hostIndex + 1, blockEnd)

  const optionIndent =
    blockLines
      .map((line) => line.match(/^(\s+)[A-Za-z]/)?.[1])
      .find((indent) => Boolean(indent)) ?? '  '

  const passthroughLines = blockLines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed) return false
    if (trimmed.startsWith('#')) return true
    const optionMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9]*)\s+(.+)$/)
    if (!optionMatch) return true
    return !(optionMatch[1].toLowerCase() in CONFIG_KEY_TO_OPTION_KEY)
  })

  const optionLines = buildOptionLines(payload.options, optionIndent)

  const nextHostLine = `Host ${[name, ...normalizedAliases].join(' ')}`
  lines.splice(hostIndex, blockEnd - hostIndex, nextHostLine, ...optionLines, ...passthroughLines)

  const normalizedGroupPath = normalizeGroupPath(payload.groupPath)
  const groupComment =
    normalizedGroupPath && normalizedGroupPath !== 'Global'
      ? `# x-sshterm-group: ${normalizedGroupPath}`
      : null

  let currentHostIndex = hostIndex
  currentHostIndex = setManagedComment(lines, currentHostIndex, GROUP_COMMENT_REGEX, groupComment)
  currentHostIndex = setManagedComment(
    lines,
    currentHostIndex,
    FAVORITE_COMMENT_REGEX,
    payload.isFavorite ? '# x-sshterm-favorites: true' : null
  )

  await writeConfigLines(configPath, lines)
}

export async function createGroupInConfig(
  configPath: string,
  parentPath: string,
  folderName: string
): Promise<void> {
  const cleanName = folderName.trim()
  if (!cleanName) {
    throw new Error('Folder name cannot be empty.')
  }
  if (cleanName.includes('/')) {
    throw new Error('Folder name cannot contain "/".')
  }

  const normalizedParent = normalizeGroupPath(parentPath)
  if (!normalizedParent) {
    throw new Error('Folder path must start with Global.')
  }

  const nextPath = normalizeGroupPath(`${normalizedParent}/${cleanName}`)
  if (!nextPath || nextPath === 'Global') {
    throw new Error('Invalid folder path.')
  }

  const lines = await readConfigLines(configPath)
  const existingDirs = collectManagedDirectories(lines)
  existingDirs.set(nextPath, null)

  const nextLines = rewriteManagedDirBlock(lines, existingDirs)
  await writeConfigLines(configPath, nextLines)
}

export async function deleteGroupInConfig(configPath: string, groupPath: string): Promise<void> {
  if (groupPath === 'Global') {
    throw new Error('Global cannot be deleted.')
  }

  const normalizedGroup = normalizeGroupPath(groupPath)
  if (!normalizedGroup) {
    throw new Error('Invalid folder path.')
  }

  const model = await parseSshConfig(configPath)
  const assigned = collectHosts(model.globalRoot)
  const hasAssignedHosts = assigned.some((host) => {
    if (!host.effectiveGroupPath) return false
    return (
      host.effectiveGroupPath === normalizedGroup ||
      host.effectiveGroupPath.startsWith(`${normalizedGroup}/`)
    )
  })

  if (hasAssignedHosts) {
    throw new Error('Directory is not empty. Move hosts before deleting.')
  }

  const lines = await readConfigLines(configPath)
  const existingDirs = collectManagedDirectories(lines)
  for (const dirPath of Array.from(existingDirs.keys())) {
    if (dirPath === normalizedGroup || dirPath.startsWith(`${normalizedGroup}/`)) {
      existingDirs.delete(dirPath)
    }
  }

  const nextLines = rewriteManagedDirBlock(lines, existingDirs)
  await writeConfigLines(configPath, nextLines)
}

export async function moveGroupInConfig(
  configPath: string,
  sourceGroupPath: string,
  targetParentGroupPath: string
): Promise<void> {
  if (sourceGroupPath === 'Global') {
    throw new Error('Global cannot be moved.')
  }

  const normalizedSource = normalizeGroupPath(sourceGroupPath)
  const normalizedTargetParent = normalizeGroupPath(targetParentGroupPath)

  if (!normalizedSource || !normalizedTargetParent) {
    throw new Error('Invalid source or target path.')
  }

  if (
    normalizedTargetParent === normalizedSource ||
    normalizedTargetParent.startsWith(`${normalizedSource}/`)
  ) {
    throw new Error('Cannot move a folder into itself.')
  }

  const leafName = normalizedSource.split('/').pop()
  if (!leafName) {
    throw new Error('Invalid source folder name.')
  }
  const destinationRoot = `${normalizedTargetParent}/${leafName}`

  const lines = await readConfigLines(configPath)

  const directories = collectManagedDirectories(lines)

  const rewrittenDirectories = new Map<string, string | null>()
  for (const [path, spaceName] of directories.entries()) {
    if (path === normalizedSource) {
      rewrittenDirectories.set(destinationRoot, spaceName)
      continue
    }
    if (path.startsWith(`${normalizedSource}/`)) {
      rewrittenDirectories.set(`${destinationRoot}${path.slice(normalizedSource.length)}`, spaceName)
      continue
    }
    rewrittenDirectories.set(path, spaceName)
  }

  const withRewrittenDirs = rewriteManagedDirBlock(lines, rewrittenDirectories)

  const rewritePath = (value: string): string => {
    if (value === normalizedSource) return destinationRoot
    if (value.startsWith(`${normalizedSource}/`)) {
      return `${destinationRoot}${value.slice(normalizedSource.length)}`
    }
    return value
  }

  const rewrittenLines = withRewrittenDirs.map((line) => {
    const trimmed = line.trim()

    const groupMatch = trimmed.match(GROUP_COMMENT_REGEX)
    if (groupMatch) {
      const normalized = normalizeGroupPath(groupMatch[1])
      if (!normalized) return line
      const rewritten = rewritePath(normalized)
      return `# x-sshterm-group: ${rewritten}`
    }

    return line
  })

  await writeConfigLines(configPath, rewrittenLines)
}

export async function convertGroupToSpaceInConfig(
  configPath: string,
  groupPath: string,
  spaceName: string
): Promise<void> {
  if (groupPath === 'Global') {
    throw new Error('Global cannot be converted to a space.')
  }

  const normalizedGroup = normalizeGroupPath(groupPath)
  if (!normalizedGroup) {
    throw new Error('Invalid folder path.')
  }

  const normalizedSpaceName = normalizeSpaceName(spaceName)
  if (!normalizedSpaceName) {
    throw new Error('Space name cannot be empty or Default.')
  }

  const existingModel = await parseSshConfig(configPath)
  const duplicateSpace = existingModel.spaces.find(
    (space) => space.name === normalizedSpaceName && space.rootGroupPath !== normalizedGroup
  )
  if (duplicateSpace) {
    throw new Error(`Space name already exists: ${normalizedSpaceName}`)
  }

  const lines = await readConfigLines(configPath)
  const directories = collectManagedDirectories(lines)
  if (!directories.has(normalizedGroup)) {
    directories.set(normalizedGroup, null)
  }
  directories.set(normalizedGroup, normalizedSpaceName)

  const nextLines = rewriteManagedDirBlock(lines, directories)
  await writeConfigLines(configPath, nextLines)
}

export async function convertSpaceToGroupInConfig(configPath: string, groupPath: string): Promise<void> {
  const normalizedGroup = normalizeGroupPath(groupPath)
  if (!normalizedGroup) {
    throw new Error('Invalid folder path.')
  }

  const lines = await readConfigLines(configPath)
  const directories = collectManagedDirectories(lines)
  if (!directories.has(normalizedGroup)) {
    throw new Error('Folder path not found in managed directories.')
  }

  directories.set(normalizedGroup, null)
  const nextLines = rewriteManagedDirBlock(lines, directories)
  await writeConfigLines(configPath, nextLines)
}

function collectHosts(node: GroupNode): HostEntry[] {
  const result = [...node.hosts]
  for (const child of node.children) {
    result.push(...collectHosts(child))
  }
  return result
}
