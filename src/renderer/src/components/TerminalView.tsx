import { useEffect, useRef } from 'react'
import { FitAddon as GhosttyFitAddon, Ghostty, Terminal as GhosttyTerminal } from 'ghostty-web'
import { Terminal as XTermTerminal } from '@xterm/xterm'
import { FitAddon as XTermFitAddon } from '@xterm/addon-fit'
import ghosttyWasmInit from 'ghostty-web/ghostty-vt.wasm?init'

type RuntimeTerminal = GhosttyTerminal | XTermTerminal
type RuntimeFitAddon = {
  fit: () => void
  dispose: () => void
  observeResize?: () => void
}

async function loadGhostty(): Promise<Ghostty> {
  const wasmFactory = ghosttyWasmInit as unknown as (
    imports?: WebAssembly.Imports
  ) => Promise<WebAssembly.Instance>

  const wasmInstance = await wasmFactory({
    env: {
      log: (ptr: number, len: number) => {
        try {
          const memory = (wasmInstance.exports as { memory?: WebAssembly.Memory }).memory
          if (!memory) return
          const bytes = new Uint8Array(memory.buffer, ptr, len)
          console.log('[ghostty-vt]', new TextDecoder().decode(bytes))
        } catch {
          // ignore logging failures
        }
      }
    }
  })

  return new Ghostty(wasmInstance)
}

function createTerminal(
  scrollbackLines: number
): Promise<{ terminal: RuntimeTerminal; engine: 'ghostty' | 'xterm'; errorMessage?: string }> {
  return loadGhostty()
    .then((ghostty) => {
      const terminal = new GhosttyTerminal({
        cursorBlink: true,
        convertEol: true,
        scrollback: scrollbackLines,
        ghostty,
        fontFamily: 'Menlo, Monaco, Consolas, monospace',
        theme: {
          background: '#000000',
          foreground: '#d7deea',
          cursor: '#9bb4d8'
        }
      })
      return { terminal, engine: 'ghostty' as const }
    })
    .catch((error) => {
      console.error('[terminal] ghostty-web unavailable, falling back to xterm', error)
      const terminal = new XTermTerminal({
        cursorBlink: true,
        convertEol: true,
        scrollback: scrollbackLines,
        fontFamily: 'Menlo, Monaco, Consolas, monospace',
        theme: {
          background: '#000000',
          foreground: '#d7deea',
          cursor: '#9bb4d8'
        }
      })
      return {
        terminal,
        engine: 'xterm' as const,
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    })
}

export default function TerminalView({
  sessionId,
  isActive,
  scrollbackLines
}: {
  sessionId: string
  isActive: boolean
  scrollbackLines: number
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<RuntimeTerminal | null>(null)
  const fitAddonRef = useRef<RuntimeFitAddon | null>(null)

  useEffect(() => {
    let observer: ResizeObserver | null = null
    let removeData: (() => void) | null = null
    let removeExit: (() => void) | null = null
    let disposableData: { dispose: () => void } | null = null
    let terminal: RuntimeTerminal | null = null
    let cancelled = false

    void (async () => {
      const created = await createTerminal(scrollbackLines)
      if (cancelled) return

      terminal = created.terminal
      const fitAddon: RuntimeFitAddon =
        created.engine === 'ghostty' ? new GhosttyFitAddon() : new XTermFitAddon()
      terminal.loadAddon(fitAddon as unknown as { activate: (terminal: unknown) => void; dispose: () => void })

      if (containerRef.current) {
        containerRef.current.replaceChildren()
        terminal.open(containerRef.current)

        if (typeof fitAddon.observeResize === 'function') {
          fitAddon.observeResize()
        }

        const fitNow = (): void => {
          fitAddon.fit()
          void window.api.resizeSession(sessionId, terminal?.cols ?? 120, terminal?.rows ?? 32)
        }

        fitNow()
        requestAnimationFrame(() => fitNow())
        window.setTimeout(() => fitNow(), 40)
        terminal.focus()
      }

      terminalRef.current = terminal
      fitAddonRef.current = fitAddon

      removeData = window.api.onSessionData((payload) => {
        if (payload.sessionId !== sessionId) return
        terminal?.write(payload.data)
      })

      removeExit = window.api.onSessionExit((payload) => {
        if (payload.sessionId !== sessionId) return
        terminal?.writeln(`\r\n[session exited with code ${payload.code}]`)
      })

      disposableData = terminal.onData((value) => {
        void window.api.writeSessionInput(sessionId, value)
      })

      if (created.engine === 'xterm') {
        const details = created.errorMessage ? `: ${created.errorMessage}` : ''
        terminal.writeln(`\r\n[ghostty init failed${details}; running with xterm fallback]\r\n`)
      }

      observer = new ResizeObserver(() => {
        fitAddon.fit()
        void window.api.resizeSession(sessionId, terminal?.cols ?? 120, terminal?.rows ?? 32)
      })

      if (containerRef.current) {
        observer.observe(containerRef.current)
        void window.api.resizeSession(sessionId, terminal.cols, terminal.rows)
      }
    })()

    return () => {
      cancelled = true
      observer?.disconnect()
      disposableData?.dispose()
      removeData?.()
      removeExit?.()
      terminal?.dispose()
      containerRef.current?.replaceChildren()
      fitAddonRef.current = null
      terminalRef.current = null
    }
  }, [sessionId, scrollbackLines])

  useEffect(() => {
    if (!isActive) return
    const fitAddon = fitAddonRef.current
    const terminal = terminalRef.current
    if (!fitAddon || !terminal) return

    const resizeNow = (): void => {
      fitAddon.fit()
      const refresh = (terminal as unknown as { refresh?: (start: number, end: number) => void }).refresh
      if (typeof refresh === 'function') {
        refresh(0, Math.max(0, terminal.rows - 1))
      }
      void window.api.resizeSession(sessionId, terminal.cols, terminal.rows)
    }

    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      resizeNow()

      raf2 = requestAnimationFrame(() => {
        resizeNow()
      })
    })

    const t1 = window.setTimeout(() => resizeNow(), 60)
    const t2 = window.setTimeout(() => resizeNow(), 180)
    const t3 = window.setTimeout(() => terminal.focus(), 0)

    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [isActive, sessionId])

  return <div className="terminal-view" ref={containerRef} />
}
