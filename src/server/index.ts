import fs from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import type { HostEditorPayload, HostUpdatePayload } from '../shared/api'
import type { CreateSessionRequest } from '../shared/types'
import { getSettings, setConfigFilePath, updateSettings } from '../main/settings'
import { checkHostsReachability } from '../main/reachability'
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
} from '../main/ssh-config'
import { SessionManager } from '../main/session'

interface InvokeRequest {
  method: string
  params?: unknown
}

interface SocketRequest extends InvokeRequest {
  type: 'invoke' | 'notify'
  id?: number
}

const isDevelopment = process.env.SSHTERM_DEV === '1' || process.argv.includes('--dev')
const port = Number(process.env.PORT ?? (isDevelopment ? 4174 : 4173))
const host = '127.0.0.1'
const clientRoot = path.resolve(process.cwd(), 'dist/client')
const activeManagers = new Set<SessionManager>()

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(JSON.stringify(body))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isLoopbackHostname(value: string): boolean {
  return value === '127.0.0.1' || value === 'localhost' || value === '[::1]'
}

function isAllowedBrowserHostname(value: string): boolean {
  return isLoopbackHostname(value) || value === 'sshterm.test'
}

function isAllowedBrowserRequest(request: IncomingMessage): boolean {
  const hostHeader = request.headers.host
  if (!hostHeader) return false

  try {
    if (!isAllowedBrowserHostname(new URL(`http://${hostHeader}`).hostname)) return false
    const origin = request.headers.origin
    return !origin || isAllowedBrowserHostname(new URL(origin).hostname)
  } catch {
    return false
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 1024 * 1024) throw new Error('Request body is too large.')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

async function invoke(method: string, rawParams: unknown): Promise<unknown> {
  const params = (rawParams ?? {}) as Record<string, unknown>

  switch (method) {
    case 'getSettings':
      return getSettings()
    case 'setConfigPath': {
      const settings = setConfigFilePath(String(params.configPath ?? ''))
      return parseSshConfig(settings.configFilePath)
    }
    case 'updateSettings': {
      const settings = updateSettings(params)
      return { settings, model: await parseSshConfig(settings.configFilePath) }
    }
    case 'getHosts': {
      const settings = getSettings()
      return parseSshConfig(settings.configFilePath)
    }
    case 'checkReachability':
      return checkHostsReachability(params.hosts as Array<{ alias: string; target: string }>)
    case 'assignHostGroup': {
      const settings = getSettings()
      await assignHostGroupInConfig(
        settings.configFilePath,
        String(params.alias ?? ''),
        String(params.groupPath ?? '')
      )
      return parseSshConfig(settings.configFilePath)
    }
    case 'setHostFavorite': {
      const settings = getSettings()
      await setHostFavoriteInConfig(
        settings.configFilePath,
        String(params.alias ?? ''),
        Boolean(params.isFavorite)
      )
      return parseSshConfig(settings.configFilePath)
    }
    case 'updateHostSettings': {
      const settings = getSettings()
      await updateHostSettingsInConfig(
        settings.configFilePath,
        params as unknown as HostUpdatePayload
      )
      return parseSshConfig(settings.configFilePath)
    }
    case 'moveGroup': {
      const settings = getSettings()
      await moveGroupInConfig(
        settings.configFilePath,
        String(params.sourceGroupPath ?? ''),
        String(params.targetParentGroupPath ?? '')
      )
      return parseSshConfig(settings.configFilePath)
    }
    case 'createGroup': {
      const settings = getSettings()
      await createGroupInConfig(
        settings.configFilePath,
        String(params.parentPath ?? ''),
        String(params.folderName ?? '')
      )
      return parseSshConfig(settings.configFilePath)
    }
    case 'deleteGroup': {
      const settings = getSettings()
      await deleteGroupInConfig(settings.configFilePath, String(params.groupPath ?? ''))
      return parseSshConfig(settings.configFilePath)
    }
    case 'convertGroupToSpace': {
      const settings = getSettings()
      await convertGroupToSpaceInConfig(
        settings.configFilePath,
        String(params.groupPath ?? ''),
        String(params.spaceName ?? '')
      )
      return parseSshConfig(settings.configFilePath)
    }
    case 'convertSpaceToGroup': {
      const settings = getSettings()
      await convertSpaceToGroupInConfig(settings.configFilePath, String(params.groupPath ?? ''))
      return parseSshConfig(settings.configFilePath)
    }
    case 'deleteHost': {
      const settings = getSettings()
      await deleteHostInConfig(settings.configFilePath, String(params.alias ?? ''))
      return parseSshConfig(settings.configFilePath)
    }
    case 'addHost': {
      const settings = getSettings()
      await addHostInConfig(settings.configFilePath, params as unknown as HostEditorPayload)
      return parseSshConfig(settings.configFilePath)
    }
    case 'clearHostGroup': {
      const settings = getSettings()
      await clearHostGroupInConfig(settings.configFilePath, String(params.alias ?? ''))
      return parseSshConfig(settings.configFilePath)
    }
    default:
      throw new Error(`Unknown API method: ${method}`)
  }
}

function contentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.wasm':
      return 'application/wasm'
    default:
      return 'application/octet-stream'
  }
}

function serveClient(request: IncomingMessage, response: ServerResponse): void {
  if (isDevelopment) {
    sendJson(response, 404, { ok: false, error: 'Use the Vite development URL.' })
    return
  }

  const requestPath = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  const requestedFile = requestPath === '/' ? 'index.html' : requestPath.slice(1)
  let filePath = path.resolve(clientRoot, requestedFile)
  if (!filePath.startsWith(`${clientRoot}${path.sep}`) && filePath !== clientRoot) {
    sendJson(response, 403, { ok: false, error: 'Forbidden' })
    return
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(clientRoot, 'index.html')
  }
  if (!fs.existsSync(filePath)) {
    sendJson(response, 503, { ok: false, error: 'Browser assets are missing. Run npm run build.' })
    return
  }

  response.writeHead(200, {
    'Content-Type': contentType(filePath),
    'Cache-Control': filePath.endsWith('index.html')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff'
  })
  if (request.method === 'HEAD') {
    response.end()
  } else {
    fs.createReadStream(filePath).pipe(response)
  }
}

const server = http.createServer(async (request, response) => {
  if (!isAllowedBrowserRequest(request)) {
    sendJson(response, 403, { ok: false, error: 'Requests must come from this local app.' })
    return
  }

  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  if (pathname === '/api/health' && request.method === 'GET') {
    sendJson(response, 200, { ok: true })
    return
  }
  if (pathname === '/api/invoke' && request.method === 'POST') {
    try {
      const body = (await readJsonBody(request)) as InvokeRequest
      const result = await invoke(body.method, body.params)
      sendJson(response, 200, { ok: true, result })
    } catch (error) {
      sendJson(response, 400, { ok: false, error: errorMessage(error) })
    }
    return
  }
  if (pathname.startsWith('/api/')) {
    sendJson(response, 404, { ok: false, error: 'Not found' })
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' })
    return
  }
  serveClient(request, response)
})

const socketServer = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  if (pathname !== '/api/ws' || !isAllowedBrowserRequest(request)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  socketServer.handleUpgrade(request, socket, head, (webSocket) => {
    socketServer.emit('connection', webSocket, request)
  })
})

socketServer.on('connection', (socket) => {
  const sendEvent = (event: string, payload: unknown): void => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'event', event, payload }))
    }
  }

  const manager = new SessionManager(
    (sessionId, data) => sendEvent('sessionData', { sessionId, data }),
    (sessionId, code) => sendEvent('sessionExit', { sessionId, code }),
    (event) => sendEvent('sessionHostKeyChanged', event),
    (event) => sendEvent('sessionAuthenticationFallback', event)
  )
  activeManagers.add(manager)

  socket.on('message', (raw: RawData) => {
    void handleSocketMessage(socket, manager, raw)
  })
  socket.on('close', () => {
    manager.closeAll()
    activeManagers.delete(manager)
  })
})

async function handleSocketMessage(
  socket: WebSocket,
  manager: SessionManager,
  raw: RawData
): Promise<void> {
  let request: SocketRequest
  try {
    request = JSON.parse(raw.toString()) as SocketRequest
  } catch {
    return
  }

  try {
    const params = (request.params ?? {}) as Record<string, unknown>
    let result: unknown
    switch (request.method) {
      case 'createSession': {
        const settings = getSettings()
        const sessionId = manager.createSession(
          params as unknown as CreateSessionRequest,
          settings.configFilePath
        )
        result = { sessionId }
        break
      }
      case 'acceptHostKeyChange': {
        const settings = getSettings()
        manager.acceptHostKeyChange(String(params.alias ?? ''), settings.configFilePath)
        break
      }
      case 'writeSessionInput':
        manager.writeInput(String(params.sessionId ?? ''), String(params.data ?? ''))
        break
      case 'resizeSession':
        manager.resize(
          String(params.sessionId ?? ''),
          Number(params.cols ?? 120),
          Number(params.rows ?? 32)
        )
        break
      case 'closeSession':
        manager.close(String(params.sessionId ?? ''))
        break
      default:
        throw new Error(`Unknown session method: ${request.method}`)
    }

    if (request.type === 'invoke' && typeof request.id === 'number') {
      socket.send(JSON.stringify({ type: 'response', id: request.id, ok: true, result }))
    }
  } catch (error) {
    if (request.type === 'invoke' && typeof request.id === 'number') {
      socket.send(
        JSON.stringify({ type: 'response', id: request.id, ok: false, error: errorMessage(error) })
      )
    } else {
      console.error(errorMessage(error))
    }
  }
}

function shutdown(): void {
  for (const manager of activeManagers) manager.closeAll()
  socketServer.close()
  server.close(() => process.exit(0))
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

server.listen(port, host, () => {
  const url = isDevelopment ? 'http://127.0.0.1:5173' : `http://${host}:${port}`
  console.log(`sshterm is available at ${url}`)
})
