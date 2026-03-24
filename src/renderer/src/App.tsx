import { useEffect, useMemo, useRef, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import Select from 'react-select'
import type { StylesConfig } from 'react-select'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
  PanelLeft,
  PanelLeftClose,
  Plus,
  RotateCw,
  Server,
  Settings,
  X
} from 'lucide-react'
import type { GroupNode, HostEntry, HostOptions, SshConfigModel } from '../../shared/types'
import TerminalView from './components/TerminalView'

interface SessionTab {
  id: string
  label: string
  sessionId: string
}

interface GroupPickNode {
  name: string
  path: string
  children: GroupPickNode[]
}

interface DragPayload {
  type: 'host' | 'group'
  value: string
}

interface HostKeyAlert {
  sessionId: string
  alias: string
  fingerprint: string | null
  knownHostsPath: string | null
  offendingLine: number | null
  message: string
}

type ReachabilityState = Record<string, boolean | undefined>

interface HostSettingsDraft {
  currentAlias: string
  name: string
  aliasesText: string
  groupPath: string
  isFavorite: boolean
  options: HostOptions
}

interface SpaceOption {
  value: string
  label: string
}

const SPACE_SELECT_STYLES: StylesConfig<SpaceOption, false> = {
  control: (base, state) => ({
    ...base,
    minHeight: 36,
    backgroundColor: '#0c1523',
    borderColor: state.isFocused ? 'var(--ui-accent-border)' : 'var(--ui-border-strong)',
    boxShadow: state.isFocused ? '0 0 0 1px color-mix(in srgb, var(--ui-accent-border) 70%, transparent)' : 'none',
    borderRadius: 5,
    '&:hover': {
      borderColor: 'var(--ui-accent-border)'
    }
  }),
  valueContainer: (base) => ({
    ...base,
    padding: '0 8px'
  }),
  singleValue: (base) => ({
    ...base,
    color: '#e5ebf5',
    fontSize: 13
  }),
  placeholder: (base) => ({
    ...base,
    color: 'var(--ui-text-muted)',
    fontSize: 13
  }),
  input: (base) => ({
    ...base,
    color: '#e5ebf5',
    fontSize: 13
  }),
  indicatorSeparator: () => ({ display: 'none' }),
  dropdownIndicator: (base, state) => ({
    ...base,
    color: state.isFocused ? '#9ec2ef' : '#8ea4c4',
    '&:hover': {
      color: '#9ec2ef'
    }
  }),
  menu: (base) => ({
    ...base,
    backgroundColor: '#0b1422',
    border: '1px solid var(--ui-border-strong)',
    boxShadow: 'none',
    borderRadius: 6
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 4000
  }),
  option: (base, state) => ({
    ...base,
    fontSize: 13,
    backgroundColor: state.isSelected
      ? 'var(--ui-accent)'
      : state.isFocused
        ? '#14243a'
        : 'transparent',
    color: state.isSelected ? '#d7e8ff' : '#d7deea',
    cursor: 'pointer'
  })
}

const ADVANCED_OPTION_GROUPS: Array<
  Array<{ key: keyof HostOptions; label: string; placeholder?: string }>
> = [
  [
    { key: 'identityFile', label: 'IdentityFile' },
    { key: 'identitiesOnly', label: 'IdentitiesOnly' }
  ],
  [
    { key: 'proxyJump', label: 'ProxyJump' },
    { key: 'proxyCommand', label: 'ProxyCommand' }
  ],
  [
    { key: 'localForward', label: 'LocalForward' },
    { key: 'remoteForward', label: 'RemoteForward' }
  ],
  [
    { key: 'serverAliveInterval', label: 'ServerAliveInterval' },
    { key: 'serverAliveCountMax', label: 'ServerAliveCountMax' }
  ],
  [
    { key: 'strictHostKeyChecking', label: 'StrictHostKeyChecking' },
    { key: 'userKnownHostsFile', label: 'UserKnownHostsFile' }
  ],
  [
    { key: 'forwardAgent', label: 'ForwardAgent' },
    { key: 'compression', label: 'Compression' }
  ],
  [
    { key: 'connectTimeout', label: 'ConnectTimeout' },
    { key: 'preferredAuthentications', label: 'PreferredAuthentications' }
  ],
  [{ key: 'logLevel', label: 'LogLevel' }]
]

function makeHostSettingsDraft(host: HostEntry): HostSettingsDraft {
  return {
    currentAlias: host.alias,
    name: host.aliases[0] ?? host.alias,
    aliasesText: host.aliases.slice(1).join(' '),
    groupPath: host.effectiveGroupPath ?? 'Global',
    isFavorite: host.isFavorite,
    options: {
      ...host.options
    }
  }
}

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

function createEmptyHostSettingsDraft(): HostSettingsDraft {
  return {
    currentAlias: '',
    name: '',
    aliasesText: '',
    groupPath: 'Global',
    isFavorite: false,
    options: createEmptyHostOptions()
  }
}

function buildGroupPickTree(paths: string[]): GroupPickNode {
  const root: GroupPickNode = { name: 'Global', path: 'Global', children: [] }

  for (const path of paths) {
    if (!path.startsWith('Global')) continue
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 1) continue

    let cursor = root
    for (let index = 1; index < parts.length; index++) {
      const name = parts[index]
      const nodePath = parts.slice(0, index + 1).join('/')
      let child = cursor.children.find((entry) => entry.path === nodePath)
      if (!child) {
        child = { name, path: nodePath, children: [] }
        cursor.children.push(child)
      }
      cursor = child
    }
  }

  const sort = (node: GroupPickNode): void => {
    node.children.sort((left, right) => left.name.localeCompare(right.name))
    node.children.forEach(sort)
  }
  sort(root)
  return root
}

function setDragPayload(event: React.DragEvent, payload: DragPayload): void {
  event.dataTransfer.setData('application/x-sshterm-drag', JSON.stringify(payload))
  event.dataTransfer.setData('text/plain', `${payload.type}:${payload.value}`)
  event.dataTransfer.effectAllowed = 'move'
}

function getDragPayload(event: React.DragEvent): DragPayload | null {
  const raw = event.dataTransfer.getData('application/x-sshterm-drag') || event.dataTransfer.getData('text/plain')
  if (!raw) return null

  try {
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as DragPayload
      if (parsed.type === 'host' || parsed.type === 'group') {
        return parsed
      }
      return null
    }

    const [type, ...valueParts] = raw.split(':')
    const value = valueParts.join(':')
    if ((type === 'host' || type === 'group') && value) {
      return { type, value }
    }
  } catch {
    return null
  }

  return null
}

function ReachabilityIndicator(): React.JSX.Element {
  return (
    <Tooltip.Provider delayDuration={0} skipDelayDuration={0} disableHoverableContent>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="reachability-indicator" aria-label="Host not responding">
            <span className="reachability-dot" />
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="reachability-tooltip" side="right" sideOffset={8}>
            Host not responding
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

function DeviceOverflowAction({
  onClick
}: {
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}): React.JSX.Element {
  return (
    <Tooltip.Provider delayDuration={0} skipDelayDuration={0} disableHoverableContent>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button className="row-action clickable" onClick={onClick}>
            <MoreHorizontal size={14} />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="ui-tooltip" side="right" sideOffset={8}>
            Open Device Settings (When device is open: ⌘⇧,)
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

function HeaderActionButton({
  tooltip,
  onClick,
  children
}: {
  tooltip: string
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip.Provider delayDuration={0} skipDelayDuration={0} disableHoverableContent>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button className="toggle-sidebar clickable" onClick={onClick}>
            {children}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="ui-tooltip" side="bottom" sideOffset={8}>
            {tooltip}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

function GroupPickTree({
  node,
  depth,
  expanded,
  toggle,
  selectedPath,
  onSelect
}: {
  node: GroupPickNode
  depth: number
  expanded: Set<string>
  toggle: (path: string) => void
  selectedPath: string
  onSelect: (path: string) => void
}): React.JSX.Element {
  return (
    <ul className="group-tree picker-tree">
      <li>
        <div
          className={selectedPath === node.path ? 'folder picker selected clickable' : 'folder picker clickable'}
          style={{ paddingLeft: `${depth * 14}px` }}
        >
          <button className="icon-btn" onClick={() => toggle(node.path)}>
            {expanded.has(node.path) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {expanded.has(node.path) ? <FolderOpen size={14} /> : <Folder size={14} />}
          <button className="picker-label" onClick={() => onSelect(node.path)}>
            <span>{node.name}</span>
            {selectedPath === node.path ? <Check size={14} /> : null}
          </button>
        </div>
        {expanded.has(node.path)
          ? node.children.map((child) => (
              <GroupPickTree
                key={child.path}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                toggle={toggle}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))
          : null}
      </li>
    </ul>
  )
}

function GroupTree({
  node,
  expandedFolders,
  activeSpaceName,
  activeHostAlias,
  onToggleFolder,
  onConnect,
  onHostMenu,
  onFolderMenu,
  onDropToFolder,
  hostReachability,
  dropTargetPath,
  onDragOverFolder,
  onDragLeaveFolder,
  onDragBegin,
  onDragFinish
}: {
  node: GroupNode
  expandedFolders: Set<string>
  activeSpaceName: string
  activeHostAlias: string | null
  onToggleFolder: (path: string) => void
  onConnect: (alias: string) => void
  onHostMenu: (host: HostEntry) => void
  onFolderMenu: (path: string, anchor: { x: number; y: number }) => void
  onDropToFolder: (payload: DragPayload, targetFolderPath: string) => void
  hostReachability: ReachabilityState
  dropTargetPath: string | null
  onDragOverFolder: (path: string) => void
  onDragLeaveFolder: (path: string) => void
  onDragBegin: () => void
  onDragFinish: () => void
}): React.JSX.Element {
  const visibleChildren = node.children.filter((child) => {
    if (activeSpaceName === 'Default') {
      return child.effectiveSpaceName === 'Default'
    }
    return child.effectiveSpaceName === activeSpaceName
  })

  const visibleHosts = node.hosts.filter((host) => host.effectiveSpaceName === activeSpaceName)

  return (
    <ul className="group-tree">
      {visibleChildren.map((child) => {
        const open = expandedFolders.has(child.path)
        return (
          <li key={child.path}>
            <div
              className={dropTargetPath === child.path ? 'row folder-row clickable drop-target' : 'row folder-row clickable'}
              onClick={() => onToggleFolder(child.path)}
              draggable
              onDragStart={(event) => {
                onDragBegin()
                setDragPayload(event, { type: 'group', value: child.path })
              }}
              onDragEnd={onDragFinish}
              onDragOver={(event) => {
                event.preventDefault()
                onDragOverFolder(child.path)
              }}
              onDragLeave={() => onDragLeaveFolder(child.path)}
              onDrop={(event) => {
                event.preventDefault()
                const payload = getDragPayload(event)
                if (!payload) return
                onDropToFolder(payload, child.path)
              }}
            >
              <div
                className="row-main"
                onContextMenu={(event) => {
                  event.preventDefault()
                  onFolderMenu(child.path, { x: event.clientX, y: event.clientY })
                }}
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {open ? <FolderOpen size={14} /> : <Folder size={14} />}
                <span>{child.name}</span>
              </div>
              <button
                className="row-action clickable"
                title="Folder actions"
                onClick={(event) => {
                  event.stopPropagation()
                  const rect = event.currentTarget.getBoundingClientRect()
                  onFolderMenu(child.path, { x: rect.left, y: rect.bottom + 4 })
                }}
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
            {open ? (
              <GroupTree
                node={child}
                expandedFolders={expandedFolders}
                activeSpaceName={activeSpaceName}
                activeHostAlias={activeHostAlias}
                onToggleFolder={onToggleFolder}
                onConnect={onConnect}
                onHostMenu={onHostMenu}
                onFolderMenu={onFolderMenu}
                onDropToFolder={onDropToFolder}
                hostReachability={hostReachability}
                dropTargetPath={dropTargetPath}
                onDragOverFolder={onDragOverFolder}
                onDragLeaveFolder={onDragLeaveFolder}
                onDragBegin={onDragBegin}
                onDragFinish={onDragFinish}
              />
            ) : null}
          </li>
        )
      })}

      {visibleHosts.map((host) => (
        <li key={host.alias}>
          <div
            className={
              host.alias === activeHostAlias
                ? 'row host-row host active clickable'
                : 'row host-row host clickable'
            }
            draggable
            onDragStart={(event) => {
              onDragBegin()
              setDragPayload(event, { type: 'host', value: host.alias })
            }}
            onDragEnd={onDragFinish}
            onDoubleClick={() => void onConnect(host.alias)}
          >
            <div
              className="row-main"
              onContextMenu={(event) => {
                event.preventDefault()
                onHostMenu(host)
              }}
            >
              <Server size={14} />
              <span>{host.alias}</span>
            </div>
            <div className="row-actions">
              {hostReachability[host.alias] === false ? <ReachabilityIndicator /> : null}
              <DeviceOverflowAction
                onClick={(event) => {
                  event.stopPropagation()
                  onHostMenu(host)
                }}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function collectFavoriteHosts(model: SshConfigModel): HostEntry[] {
  const favorites = new Map<string, HostEntry>()

  const walk = (node: GroupNode): void => {
    for (const host of node.hosts) {
      if (host.isFavorite) favorites.set(host.alias, host)
    }
    for (const child of node.children) {
      walk(child)
    }
  }

  walk(model.globalRoot)
  for (const host of model.unassigned) {
    if (host.isFavorite) favorites.set(host.alias, host)
  }

  return Array.from(favorites.values()).sort((left, right) => left.alias.localeCompare(right.alias))
}

function collectAllHosts(model: SshConfigModel): HostEntry[] {
  const allHosts: HostEntry[] = []

  const walk = (node: GroupNode): void => {
    allHosts.push(...node.hosts)
    node.children.forEach(walk)
  }

  walk(model.globalRoot)
  allHosts.push(...model.unassigned)

  return allHosts
}

function findHostByAlias(model: SshConfigModel, alias: string): HostEntry | null {
  return collectAllHosts(model).find((host) => host.alias === alias) ?? null
}

function findGroupByPath(node: GroupNode, groupPath: string): GroupNode | null {
  if (node.path === groupPath) return node
  for (const child of node.children) {
    const found = findGroupByPath(child, groupPath)
    if (found) return found
  }
  return null
}

function filterHostsBySpace(hosts: HostEntry[], activeSpaceName: string): HostEntry[] {
  return hosts.filter((host) => host.effectiveSpaceName === activeSpaceName)
}

function App(): React.JSX.Element {
  const [model, setModel] = useState<SshConfigModel | null>(null)
  const [tabs, setTabs] = useState<SessionTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [assigningHost, setAssigningHost] = useState<HostEntry | null>(null)
  const [hostSettingsDraft, setHostSettingsDraft] = useState<HostSettingsDraft | null>(null)
  const [isAdvancedExpanded, setIsAdvancedExpanded] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  const [sidebarWidth, setSidebarWidth] = useState(380)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['Global']))
  const [isFavoritesExpanded, setIsFavoritesExpanded] = useState(true)
  const [isUnassignedExpanded, setIsUnassignedExpanded] = useState(true)
  const [activeSpaceName, setActiveSpaceName] = useState('Default')

  const [editingFolderPath, setEditingFolderPath] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [folderError, setFolderError] = useState<string | null>(null)
  const [folderContextMenu, setFolderContextMenu] = useState<{
    groupPath: string
    x: number
    y: number
  } | null>(null)
  const [movingFolderPath, setMovingFolderPath] = useState<string | null>(null)
  const [moveTargetSpaceName, setMoveTargetSpaceName] = useState('')

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsConfigPath, setSettingsConfigPath] = useState('')
  const [settingsScrollbackLines, setSettingsScrollbackLines] = useState(5000)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [hostKeyAlert, setHostKeyAlert] = useState<HostKeyAlert | null>(null)

  const [expandedPickerFolders, setExpandedPickerFolders] = useState<Set<string>>(new Set(['Global']))
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hostReachability, setHostReachability] = useState<ReachabilityState>({})

  const isResizingRef = useRef(false)
  const reachabilityRunRef = useRef(0)

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId]
  )
  const activeHostAlias = activeTab?.label ?? null
  const favoriteHosts = useMemo(
    () => (model ? filterHostsBySpace(collectFavoriteHosts(model), activeSpaceName) : []),
    [model, activeSpaceName]
  )

  const activeSpaceRoot = useMemo(() => {
    if (!model || activeSpaceName === 'Default') return null
    return model.spaces.find((space) => space.name === activeSpaceName) ?? null
  }, [model, activeSpaceName])

  const activeTreeNode = useMemo(() => {
    if (!model) return null
    if (!activeSpaceRoot) return model.globalRoot
    return findGroupByPath(model.globalRoot, activeSpaceRoot.rootGroupPath)
  }, [model, activeSpaceRoot])

  const activeUnassignedHosts = useMemo(() => {
    if (!model) return []
    return filterHostsBySpace(model.unassigned, activeSpaceName)
  }, [model, activeSpaceName])

  const groupPickTree = useMemo(() => {
    if (!model) return null
    return buildGroupPickTree(model.availableGroups)
  }, [model])

  useEffect(() => {
    if (!model) return
    if (model.availableSpaceNames.includes(activeSpaceName)) return
    setActiveSpaceName('Default')
  }, [model, activeSpaceName])

  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      if (!isResizingRef.current || isSidebarCollapsed) return
      setSidebarWidth(Math.min(700, Math.max(220, event.clientX)))
    }
    const onUp = (): void => {
      isResizingRef.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isSidebarCollapsed])

  useEffect(() => {
    const dispose = window.api.onOpenSettings(() => {
      setIsSettingsOpen(true)
    })
    return () => dispose()
  }, [])

  useEffect(() => {
    const dispose = window.api.onOpenActiveDeviceSettings(() => {
      if (!model || !activeHostAlias) return
      const host = findHostByAlias(model, activeHostAlias)
      if (!host) return
      openHostMenu(host)
    })
    return () => dispose()
  }, [model, activeHostAlias])

  useEffect(() => {
    const dispose = window.api.onToggleSidebar(() => {
      setIsSidebarCollapsed((current) => !current)
    })
    return () => dispose()
  }, [])

  useEffect(() => {
    const dispose = window.api.onSessionHostKeyChanged((payload) => {
      setHostKeyAlert(payload)
    })
    return () => dispose()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return

      if (hostKeyAlert) {
        setHostKeyAlert(null)
        return
      }

      if (assigningHost || hostSettingsDraft) {
        setAssigningHost(null)
        setHostSettingsDraft(null)
        setIsAdvancedExpanded(false)
        return
      }

      if (editingFolderPath) {
        setEditingFolderPath(null)
        return
      }

      if (movingFolderPath) {
        setMovingFolderPath(null)
        return
      }

      if (folderContextMenu) {
        setFolderContextMenu(null)
        return
      }

      if (isSettingsOpen) {
        setIsSettingsOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hostKeyAlert, assigningHost, hostSettingsDraft, editingFolderPath, movingFolderPath, folderContextMenu, isSettingsOpen])

  useEffect(() => {
    const boot = async (): Promise<void> => {
      const settings = await window.api.getSettings()
      setSettingsConfigPath(settings.configFilePath)
      setSettingsScrollbackLines(settings.scrollbackLines)
      const hosts = await window.api.getHosts()
      setModel(hosts)
      void checkReachability(hosts)
    }
    void boot()
  }, [])

  const checkReachability = async (nextModel: SshConfigModel): Promise<void> => {
    const runId = ++reachabilityRunRef.current
    const hosts = collectAllHosts(nextModel)

    setHostReachability((current) => {
      const next: ReachabilityState = {}
      for (const host of hosts) {
        next[host.alias] = current[host.alias]
      }
      return next
    })

    if (hosts.length === 0) return

    try {
      const result = await window.api.checkReachability(
        hosts.map((host) => ({ alias: host.alias, target: host.pingTarget }))
      )

      if (reachabilityRunRef.current !== runId) return

      setHostReachability((current) => {
        const next = { ...current }
        for (const entry of result) {
          next[entry.alias] = entry.reachable
        }
        return next
      })
    } catch {
      // best effort: reachability checks should never block host operations
    }
  }

  const reloadHostsAndCheckReachability = async (): Promise<void> => {
    try {
      setConnectionError(null)
      const next = await window.api.getHosts()
      setModel(next)
      void checkReachability(next)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConnectionError(message)
    }
  }

  const connectHost = async (alias: string): Promise<void> => {
    try {
      setConnectionError(null)

      const { sessionId } = await window.api.createSession({ alias, cols: 120, rows: 32 })
      const tab: SessionTab = { id: crypto.randomUUID(), label: alias, sessionId }
      setTabs((previous) => [...previous, tab])
      setActiveTabId(tab.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConnectionError(`Failed to open session for ${alias}: ${message}`)
    }
  }

  const closeTab = async (tab: SessionTab): Promise<void> => {
    setTabs((previous) => {
      const remaining = previous.filter((entry) => entry.id !== tab.id)
      setActiveTabId((current) => {
        if (current !== tab.id) return current
        return remaining.length ? remaining[remaining.length - 1].id : null
      })
      return remaining
    })

    try {
      await window.api.closeSession(tab.sessionId)
    } catch {
      // best effort: session may already be closed
    }
  }

  const openFolderMenu = (groupPath: string, anchor: { x: number; y: number }): void => {
    setFolderContextMenu({
      groupPath,
      x: anchor.x,
      y: anchor.y
    })
  }

  const openFolderEditor = (groupPath: string): void => {
    setEditingFolderPath(groupPath)
    setNewFolderName('')
    setFolderError(null)
  }

  const toggleFolder = (groupPath: string): void => {
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(groupPath)) next.delete(groupPath)
      else next.add(groupPath)
      return next
    })
  }

  const togglePickerFolder = (groupPath: string): void => {
    setExpandedPickerFolders((current) => {
      const next = new Set(current)
      if (next.has(groupPath)) next.delete(groupPath)
      else next.add(groupPath)
      return next
    })
  }

  const createSubdirectory = async (): Promise<void> => {
    if (!editingFolderPath) return
    try {
      setFolderError(null)
      const next = await window.api.createGroup(editingFolderPath, newFolderName)
      setModel(next)
      setNewFolderName('')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFolderError(message)
    }
  }

  const deleteDirectory = async (): Promise<void> => {
    if (!editingFolderPath) return
    try {
      setFolderError(null)
      const next = await window.api.deleteGroup(editingFolderPath)
      setModel(next)
      setEditingFolderPath(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFolderError(message)
    }
  }

  const convertFolderToSpace = async (groupPath: string): Promise<void> => {
    if (!model) return

    const node = findGroupByPath(model.globalRoot, groupPath)
    if (!node) {
      setConnectionError('Folder not found.')
      return
    }

    try {
      setConnectionError(null)
      const next = await window.api.convertGroupToSpace(groupPath, node.name)
      setModel(next)
      setActiveSpaceName(node.name)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConnectionError(message)
    }
  }

  const convertSpaceToFolder = async (groupPath: string): Promise<void> => {
    try {
      setConnectionError(null)
      const next = await window.api.convertSpaceToGroup(groupPath)
      setModel(next)
      setActiveSpaceName('Default')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConnectionError(message)
    }
  }

  const openMoveFolderToSpaceDialog = (groupPath: string): void => {
    if (!model) return

    const currentNode = findGroupByPath(model.globalRoot, groupPath)
    if (!currentNode) return

    const availableSpaces = ['Default', ...model.spaces.map((space) => space.name)].filter(
      (spaceName) => spaceName !== currentNode.effectiveSpaceName
    )

    if (availableSpaces.length === 0) {
      setConnectionError('No destination spaces available.')
      return
    }

    setMoveTargetSpaceName(availableSpaces[0])
    setMovingFolderPath(groupPath)
  }

  const moveFolderToSpace = async (): Promise<void> => {
    if (!model || !movingFolderPath || !moveTargetSpaceName) return

    const destinationParentPath =
      moveTargetSpaceName === 'Default'
        ? 'Global'
        : (model.spaces.find((space) => space.name === moveTargetSpaceName)?.rootGroupPath ?? null)
    if (!destinationParentPath) {
      setConnectionError('Destination space not found.')
      return
    }

    try {
      setConnectionError(null)
      const next = await window.api.moveGroup(movingFolderPath, destinationParentPath)
      setModel(next)
      setMovingFolderPath(null)
      setMoveTargetSpaceName('')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConnectionError(message)
    }
  }

  const saveHostSettings = async (): Promise<void> => {
    if (!assigningHost || !hostSettingsDraft) return
    try {
      const payload = {
        name: hostSettingsDraft.name.trim(),
        aliases: hostSettingsDraft.aliasesText.split(/\s+/).filter(Boolean),
        groupPath: hostSettingsDraft.groupPath,
        isFavorite: hostSettingsDraft.isFavorite,
        options: hostSettingsDraft.options
      }
      const next = hostSettingsDraft.currentAlias
        ? await window.api.updateHostSettings({
            currentAlias: hostSettingsDraft.currentAlias,
            ...payload
          })
        : await window.api.addHost(payload)
      setModel(next)
      void checkReachability(next)
      setAssigningHost(null)
      setHostSettingsDraft(null)
      setIsAdvancedExpanded(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConnectionError(message)
    } finally {
      setDropTargetPath(null)
    }
  }

  const deleteHost = async (): Promise<void> => {
    if (!hostSettingsDraft?.currentAlias) return

    const confirmed = window.confirm(
      `Warning: this will permanently remove \"${hostSettingsDraft.currentAlias}\" from your SSH config. Continue?`
    )
    if (!confirmed) return

    try {
      setConnectionError(null)
      const next = await window.api.deleteHost(hostSettingsDraft.currentAlias)
      setModel(next)
      void checkReachability(next)
      setAssigningHost(null)
      setHostSettingsDraft(null)
      setIsAdvancedExpanded(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConnectionError(message)
    }
  }

  function openHostMenu(host: HostEntry): void {
    setHostSettingsDraft(makeHostSettingsDraft(host))
    setIsAdvancedExpanded(false)
    setAssigningHost(host)
  }

  const openCreateDeviceModal = (): void => {
    setHostSettingsDraft(createEmptyHostSettingsDraft())
    setIsAdvancedExpanded(false)
    setAssigningHost({
      alias: 'new-device',
      aliases: ['new-device'],
      pingTarget: '',
      isFavorite: false,
      options: createEmptyHostOptions(),
      sourceSpaceName: null,
      effectiveSpaceName: activeSpaceName,
      sourceGroupPath: null,
      effectiveGroupPath: 'Global',
      assignmentReason: 'no-comment'
    })
  }

  const updateHostSettingsDraft = (patch: Partial<HostSettingsDraft>): void => {
    setHostSettingsDraft((current) => {
      if (!current) return current
      return {
        ...current,
        ...patch
      }
    })
  }

  const updateDraftOption = (key: keyof HostOptions, value: string): void => {
    setHostSettingsDraft((current) => {
      if (!current) return current
      return {
        ...current,
        options: {
          ...current.options,
          [key]: value
        }
      }
    })
  }

  const onDropToFolder = async (payload: DragPayload, targetFolderPath: string): Promise<void> => {
    if (!model) return

    try {
      if (payload.type === 'host') {
        const next = await window.api.assignHostGroup(payload.value, targetFolderPath)
        setModel(next)
        return
      }

      if (payload.type === 'group') {
        const next = await window.api.moveGroup(payload.value, targetFolderPath)
        setModel(next)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConnectionError(message)
    } finally {
      setDropTargetPath(null)
    }
  }

  const onDropToUnassigned = async (payload: DragPayload): Promise<void> => {
    if (payload.type !== 'host') return
    try {
      const next = await window.api.clearHostGroup(payload.value)
      setModel(next)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConnectionError(message)
    }
  }

  const saveSettings = async (): Promise<void> => {
    try {
      setSettingsError(null)
      const next = await window.api.updateSettings({
        configFilePath: settingsConfigPath,
        scrollbackLines: settingsScrollbackLines
      })
      setSettingsConfigPath(next.settings.configFilePath)
      setSettingsScrollbackLines(next.settings.scrollbackLines)
      setModel(next.model)
      void checkReachability(next.model)
      setIsSettingsOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSettingsError(message)
    }
  }

  const handleDragOverFolder = (path: string): void => {
    if (!isDragging) return
    setDropTargetPath(path)
  }

  const handleDragLeaveFolder = (path: string): void => {
    if (dropTargetPath === path) {
      setDropTargetPath(null)
    }
  }

  const handleDragBegin = (): void => {
    setIsDragging(true)
  }

  const handleDragFinish = (): void => {
    setIsDragging(false)
    setDropTargetPath(null)
  }

  const acceptHostKeyAndReconnect = async (): Promise<void> => {
    if (!hostKeyAlert) return

    try {
      setConnectionError(null)
      await window.api.acceptHostKeyChange(hostKeyAlert.alias)

      const existingTab = tabs.find((tab) => tab.sessionId === hostKeyAlert.sessionId)
      if (!existingTab) {
        setHostKeyAlert(null)
        return
      }

      try {
        await window.api.closeSession(existingTab.sessionId)
      } catch {
        // ignore; session may already be closed
      }

      const { sessionId: nextSessionId } = await window.api.createSession({
        alias: existingTab.label,
        cols: 120,
        rows: 32
      })

      setTabs((previous) =>
        previous.map((tab) =>
          tab.id === existingTab.id
            ? {
                ...tab,
                sessionId: nextSessionId
              }
            : tab
        )
      )
      setActiveTabId(existingTab.id)
      setHostKeyAlert(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConnectionError(message)
    }
  }

  const contextMenuFolderNode =
    model && folderContextMenu ? findGroupByPath(model.globalRoot, folderContextMenu.groupPath) : null

  const destinationSpaceOptions =
    model && movingFolderPath
      ? (() => {
          const movingNode = findGroupByPath(model.globalRoot, movingFolderPath)
          const currentSpaceName = movingNode?.effectiveSpaceName ?? 'Default'
          const options = ['Default', ...model.spaces.map((space) => space.name)]
          return options.filter((spaceName) => spaceName !== currentSpaceName)
        })()
      : []

  const activeSpaceOptions: SpaceOption[] = model
    ? model.availableSpaceNames.map((spaceName) => ({
        value: spaceName,
        label: spaceName
      }))
    : []

  const destinationSpaceSelectOptions: SpaceOption[] = destinationSpaceOptions.map((spaceName) => ({
    value: spaceName,
    label: spaceName
  }))

  if (!model) {
    return <div className="loading">Loading SSH configuration...</div>
  }

  return (
    <div className="app-shell">
      <aside
        className={isSidebarCollapsed ? 'sidebar collapsed' : 'sidebar'}
        style={{ width: isSidebarCollapsed ? 48 : sidebarWidth }}
      >
        <div className="sidebar-header">
          <HeaderActionButton
            tooltip="Toggle Sidebar (⌘S)"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
          >
            {isSidebarCollapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
          </HeaderActionButton>
          {!isSidebarCollapsed ? (
            <div className="sidebar-header-actions">
              <button
                className="toggle-sidebar clickable"
                onClick={() => void reloadHostsAndCheckReachability()}
                title="Reload Hosts"
              >
                <RotateCw size={14} />
              </button>
              <button className="toggle-sidebar clickable" onClick={openCreateDeviceModal} title="Add new Device">
                <Plus size={14} />
              </button>
              <HeaderActionButton tooltip="Open App Settings (⌘,)" onClick={() => setIsSettingsOpen(true)}>
                <Settings size={14} />
              </HeaderActionButton>
            </div>
          ) : null}
        </div>

        {isSidebarCollapsed ? null : (
          <>
            <div className="sidebar-content">
              <div className="row folder-row folder-root clickable" onClick={() => setIsFavoritesExpanded((current) => !current)}>
                <div className="row-main">
                  {isFavoritesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {isFavoritesExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
                  <span>Favorites</span>
                </div>
              </div>

            {isFavoritesExpanded ? (
              <ul className="group-tree">
                {favoriteHosts.map((host) => (
                  <li key={`favorite:${host.alias}`}>
                    <div
                      className={
                        host.alias === activeHostAlias
                          ? 'row host-row host active clickable'
                          : 'row host-row host clickable'
                      }
                      draggable
                      onDragStart={(event) => {
                        handleDragBegin()
                        setDragPayload(event, { type: 'host', value: host.alias })
                      }}
                      onDragEnd={handleDragFinish}
                      onDoubleClick={() => void connectHost(host.alias)}
                    >
                      <div
                        className="row-main"
                        onContextMenu={(event) => {
                          event.preventDefault()
                          openHostMenu(host)
                        }}
                      >
                        <Server size={14} />
                        <span>{host.alias}</span>
                      </div>
                      <div className="row-actions">
                        {hostReachability[host.alias] === false ? <ReachabilityIndicator /> : null}
                        <DeviceOverflowAction
                          onClick={(event) => {
                            event.stopPropagation()
                            openHostMenu(host)
                          }}
                        />
                      </div>
                    </div>
                  </li>
                ))}
                {favoriteHosts.length === 0 ? <li className="empty">No favorites yet</li> : null}
              </ul>
            ) : null}

            <div
              className={
                dropTargetPath === (activeSpaceRoot?.rootGroupPath ?? 'Global')
                  ? 'row folder-row folder-root clickable drop-target'
                  : 'row folder-row folder-root clickable'
              }
              onClick={() => {
                if (activeSpaceRoot) return
                toggleFolder('Global')
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                openFolderMenu(activeSpaceRoot?.rootGroupPath ?? 'Global', { x: event.clientX, y: event.clientY })
              }}
              onDragOver={(event) => {
                event.preventDefault()
                handleDragOverFolder(activeSpaceRoot?.rootGroupPath ?? 'Global')
              }}
              onDragLeave={() => handleDragLeaveFolder(activeSpaceRoot?.rootGroupPath ?? 'Global')}
              onDrop={(event) => {
                event.preventDefault()
                const payload = getDragPayload(event)
                if (!payload) return
                void onDropToFolder(payload, activeSpaceRoot?.rootGroupPath ?? 'Global')
              }}
            >
              <div className="row-main">
                {activeSpaceRoot ? <FolderOpen size={14} /> : expandedFolders.has('Global') ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {activeSpaceRoot ? null : expandedFolders.has('Global') ? <FolderOpen size={14} /> : <Folder size={14} />}
                <span>{activeSpaceName === 'Default' ? 'Global' : activeSpaceName}</span>
              </div>
              <button
                className="row-action clickable"
                title="Folder actions"
                onClick={(event) => {
                  event.stopPropagation()
                  const rect = event.currentTarget.getBoundingClientRect()
                  openFolderMenu(activeSpaceRoot?.rootGroupPath ?? 'Global', { x: rect.left, y: rect.bottom + 4 })
                }}
              >
                <MoreHorizontal size={14} />
              </button>
            </div>

            {(activeSpaceRoot || expandedFolders.has('Global')) && activeTreeNode ? (
              <GroupTree
                node={activeTreeNode}
                expandedFolders={expandedFolders}
                activeSpaceName={activeSpaceName}
                activeHostAlias={activeHostAlias}
                onToggleFolder={toggleFolder}
                onConnect={connectHost}
                onHostMenu={openHostMenu}
                onFolderMenu={openFolderMenu}
                onDropToFolder={(payload, path) => void onDropToFolder(payload, path)}
                hostReachability={hostReachability}
                dropTargetPath={dropTargetPath}
                onDragOverFolder={handleDragOverFolder}
                onDragLeaveFolder={handleDragLeaveFolder}
                onDragBegin={handleDragBegin}
                onDragFinish={handleDragFinish}
              />
            ) : null}

            <div
              className="row folder-row folder-root clickable"
              onClick={() => setIsUnassignedExpanded((current) => !current)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const payload = getDragPayload(event)
                if (!payload) return
                void onDropToUnassigned(payload)
              }}
            >
              <div className="row-main">
                {isUnassignedExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {isUnassignedExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
                <span>Unassigned</span>
              </div>
              <button className="row-action clickable" title="No folder actions" disabled>
                <MoreHorizontal size={14} />
              </button>
            </div>

            {isUnassignedExpanded ? (
              <ul className="group-tree">
                {activeUnassignedHosts.map((host) => (
                  <li key={host.alias}>
                    <div
                      className={
                        host.alias === activeHostAlias
                          ? 'row host-row host unassigned active clickable'
                          : 'row host-row host unassigned clickable'
                      }
                      draggable
                      onDragStart={(event) => {
                        handleDragBegin()
                        setDragPayload(event, { type: 'host', value: host.alias })
                      }}
                      onDragEnd={handleDragFinish}
                      onDoubleClick={() => void connectHost(host.alias)}
                    >
                      <div
                        className="row-main"
                        onContextMenu={(event) => {
                          event.preventDefault()
                          openHostMenu(host)
                        }}
                      >
                        <Server size={14} />
                        <span>{host.alias}</span>
                      </div>
                      <div className="row-actions">
                        {hostReachability[host.alias] === false ? <ReachabilityIndicator /> : null}
                        <DeviceOverflowAction
                          onClick={(event) => {
                            event.stopPropagation()
                            openHostMenu(host)
                          }}
                        />
                      </div>
                    </div>
                  </li>
                ))}
                {activeUnassignedHosts.length === 0 ? <li className="empty">No unassigned hosts</li> : null}
              </ul>
            ) : null}

            </div>

            <div className="space-selector-wrap">
              <Select
                classNamePrefix="space-select"
                value={activeSpaceOptions.find((option) => option.value === activeSpaceName) ?? null}
                options={activeSpaceOptions}
                onChange={(option) => {
                  if (option) {
                    setActiveSpaceName(option.value)
                  }
                }}
                styles={SPACE_SELECT_STYLES}
                menuPortalTarget={document.body}
                menuPlacement="top"
                menuPosition="fixed"
                isSearchable={false}
              />
            </div>
          </>
        )}
      </aside>

      <div
        className="sidebar-resizer"
        onMouseDown={() => {
          if (isSidebarCollapsed) {
            setIsSidebarCollapsed(false)
          }
          isResizingRef.current = true
        }}
      />

      <main className="main-panel">
        <div className="tab-bar">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={tab.id === activeTabId ? 'tab active clickable' : 'tab clickable'}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span>{tab.label}</span>
              <button
                className="tab-close clickable"
                onClick={(event) => {
                  event.stopPropagation()
                  void closeTab(tab)
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="terminal-area">
          {connectionError ? <div className="error-banner">{connectionError}</div> : null}
          {tabs.length > 0 ? (
            tabs.map((tab) => (
              <div
                key={`${tab.id}:${tab.sessionId}`}
                className={tab.id === activeTabId ? 'terminal-pane active' : 'terminal-pane hidden'}
              >
                <TerminalView
                  sessionId={tab.sessionId}
                  isActive={tab.id === activeTabId}
                  scrollbackLines={settingsScrollbackLines}
                />
              </div>
            ))
          ) : (
            <div className="empty">Select a host to open a session</div>
          )}
        </div>
      </main>

      {folderContextMenu ? (
        <div className="context-menu-overlay" onClick={() => setFolderContextMenu(null)}>
          <div
            className="context-menu"
            style={{ left: folderContextMenu.x, top: folderContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="context-menu-item"
              onClick={() => {
                const path = folderContextMenu.groupPath
                setFolderContextMenu(null)
                openFolderEditor(path)
              }}
            >
              Edit
            </button>
            {folderContextMenu.groupPath !== 'Global' && contextMenuFolderNode?.spaceName ? (
              <button
                className="context-menu-item"
                onClick={() => {
                  const path = folderContextMenu.groupPath
                  setFolderContextMenu(null)
                  void convertSpaceToFolder(path)
                }}
              >
                Convert to folder
              </button>
            ) : null}
            {folderContextMenu.groupPath !== 'Global' && !contextMenuFolderNode?.spaceName ? (
              <button
                className="context-menu-item"
                onClick={() => {
                  const path = folderContextMenu.groupPath
                  setFolderContextMenu(null)
                  void convertFolderToSpace(path)
                }}
              >
                Convert to space
              </button>
            ) : null}
            {folderContextMenu.groupPath !== 'Global' ? (
              <button
                className="context-menu-item"
                onClick={() => {
                  const path = folderContextMenu.groupPath
                  setFolderContextMenu(null)
                  openMoveFolderToSpaceDialog(path)
                }}
              >
                Move folder to space
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {movingFolderPath ? (
        <div className="modal-overlay" onClick={() => setMovingFolderPath(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Move folder to space</h3>
            <div className="hint">Folder: {movingFolderPath}</div>
            <div className="config-row">
              <Select
                classNamePrefix="space-select"
                value={destinationSpaceSelectOptions.find((option) => option.value === moveTargetSpaceName) ?? null}
                options={destinationSpaceSelectOptions}
                onChange={(option) => {
                  setMoveTargetSpaceName(option?.value ?? '')
                }}
                styles={SPACE_SELECT_STYLES}
                menuPortalTarget={document.body}
                menuPlacement="top"
                menuPosition="fixed"
                isSearchable={false}
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => setMovingFolderPath(null)}>Cancel</button>
              <button onClick={() => void moveFolderToSpace()} disabled={!moveTargetSpaceName}>
                Move
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {assigningHost && hostSettingsDraft ? (
        <div
          className="modal-overlay"
          onClick={() => {
            setAssigningHost(null)
            setHostSettingsDraft(null)
            setIsAdvancedExpanded(false)
          }}
        >
          <div className="modal host-settings-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{hostSettingsDraft.currentAlias ? `Host settings: ${assigningHost.alias}` : 'Add new device'}</h3>
            <div className="host-settings-layout">
              <div className="host-settings-row">
                <label className="favorite-toggle clickable">
                  <span>Favorite</span>
                  <input
                    type="checkbox"
                    checked={hostSettingsDraft.isFavorite}
                    onChange={(event) => updateHostSettingsDraft({ isFavorite: event.target.checked })}
                  />
                  <span className="favorite-toggle-slider" />
                </label>
              </div>

              <div className="host-settings-grid host-settings-grid-2">
                <div>
                  <div className="hint">Name</div>
                  <div className="config-row">
                    <input
                      value={hostSettingsDraft.name}
                      onChange={(event) => updateHostSettingsDraft({ name: event.target.value })}
                      placeholder="Primary host name"
                    />
                  </div>
                </div>
                <div>
                  <div className="hint">Aliases</div>
                  <div className="config-row compact">
                    <input
                      value={hostSettingsDraft.aliasesText}
                      onChange={(event) => updateHostSettingsDraft({ aliasesText: event.target.value })}
                      placeholder="Additional aliases"
                    />
                  </div>
                  <div className="hint inline-help">Enter aliases as a space separated list.</div>
                </div>
              </div>

              <div className="host-settings-grid host-settings-grid-3">
                <div>
                  <div className="hint">Hostname</div>
                  <div className="config-row">
                    <input
                      value={hostSettingsDraft.options.hostName}
                      onChange={(event) => updateDraftOption('hostName', event.target.value)}
                      placeholder="HostName"
                    />
                  </div>
                </div>
                <div>
                  <div className="hint">User</div>
                  <div className="config-row">
                    <input
                      value={hostSettingsDraft.options.user}
                      onChange={(event) => updateDraftOption('user', event.target.value)}
                      placeholder="User"
                    />
                  </div>
                </div>
                <div>
                  <div className="hint">Port</div>
                  <div className="config-row">
                    <input
                      value={hostSettingsDraft.options.port}
                      onChange={(event) => updateDraftOption('port', event.target.value)}
                      placeholder="Port"
                    />
                  </div>
                </div>
              </div>
            </div>

            <button
              className="advanced-toggle clickable"
              onClick={() => setIsAdvancedExpanded((current) => !current)}
            >
              {isAdvancedExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>Advanced Options</span>
            </button>
            {isAdvancedExpanded ? (
              <div className="advanced-options">
                {ADVANCED_OPTION_GROUPS.map((group, index) => (
                  <div
                    key={`advanced-group:${index}`}
                    className={group.length > 1 ? 'host-settings-grid host-settings-grid-2' : 'host-settings-grid'}
                  >
                    {group.map((field) => (
                      <div key={field.key}>
                        <div className="hint">{field.label}</div>
                        <div className="config-row">
                          <input
                            value={hostSettingsDraft.options[field.key]}
                            onChange={(event) => updateDraftOption(field.key, event.target.value)}
                            placeholder={field.placeholder ?? field.label}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="hint">Group</div>
            {groupPickTree ? (
              <div className="group-list">
                <GroupPickTree
                  node={groupPickTree}
                  depth={0}
                  expanded={expandedPickerFolders}
                  toggle={togglePickerFolder}
                  selectedPath={hostSettingsDraft.groupPath}
                  onSelect={(path) => updateHostSettingsDraft({ groupPath: path })}
                />
              </div>
            ) : null}
            <div className="modal-actions">
              {hostSettingsDraft.currentAlias ? (
                <button className="danger-action" onClick={() => void deleteHost()}>
                  Delete Device
                </button>
              ) : null}
              <button
                onClick={() => {
                  setAssigningHost(null)
                  setHostSettingsDraft(null)
                  setIsAdvancedExpanded(false)
                }}
              >
                Cancel
              </button>
              <button onClick={() => void saveHostSettings()}>Save</button>
            </div>
          </div>
        </div>
      ) : null}

      {editingFolderPath ? (
        <div className="modal-overlay" onClick={() => setEditingFolderPath(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Directory: {editingFolderPath}</h3>
            {folderError ? <div className="error-banner">{folderError}</div> : null}
            <div className="config-row">
              <input
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="New subdirectory name"
              />
              <button onClick={() => void createSubdirectory()}>
                <Plus size={14} />
              </button>
            </div>
            <div className="modal-actions">
              <button onClick={() => setEditingFolderPath(null)}>Close</button>
              <button disabled={editingFolderPath === 'Global'} onClick={() => void deleteDirectory()}>
                Delete Directory
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isSettingsOpen ? (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Preferences</h3>
            {settingsError ? <div className="error-banner">{settingsError}</div> : null}
            <div className="hint">SSH config file path</div>
            <div className="config-row">
              <input
                value={settingsConfigPath}
                onChange={(event) => setSettingsConfigPath(event.target.value)}
                placeholder="SSH config file path"
              />
            </div>
            <div className="hint">Scrollback lines</div>
            <div className="config-row">
              <input
                type="number"
                min={500}
                max={200000}
                step={500}
                value={settingsScrollbackLines}
                onChange={(event) => setSettingsScrollbackLines(Number(event.target.value || 5000))}
                placeholder="Scrollback lines"
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => setIsSettingsOpen(false)}>Cancel</button>
              <button onClick={() => void saveSettings()}>Save</button>
            </div>
          </div>
        </div>
      ) : null}

      {hostKeyAlert ? (
        <div className="modal-overlay" onClick={() => setHostKeyAlert(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Host key changed for {hostKeyAlert.alias}</h3>
            <div className="modal-details">
              <div>{hostKeyAlert.message}</div>
              {hostKeyAlert.fingerprint ? <div>Fingerprint: {hostKeyAlert.fingerprint}</div> : null}
              {hostKeyAlert.knownHostsPath && hostKeyAlert.offendingLine
                ? <div>Known hosts entry: {hostKeyAlert.knownHostsPath}:{hostKeyAlert.offendingLine}</div>
                : null}
            </div>
            <div className="modal-actions">
              <button onClick={() => setHostKeyAlert(null)}>Cancel</button>
              <button onClick={() => void acceptHostKeyAndReconnect()}>Accept and Reconnect</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
