import { useEffect, useRef, useState } from 'react'
import { Terminal as XTermTerminal, type ITheme, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

const MAX_SEARCH_RESULTS = 200

export interface TerminalSearchResult {
  id: string
  line: number
  column: number
  length: number
  before: string
  beforeTruncated: boolean
  match: string
  after: string
  afterTruncated: boolean
}

interface TerminalSearchAppearance {
  matchBackground: string
  matchBorder: string
  activeMatchBackground: string
  activeMatchBorder: string
  activeMatchForeground: string
}

interface TerminalAppearance {
  theme: ITheme
  search: TerminalSearchAppearance
}

interface OverlayHighlight {
  id: string
  left: number
  top: number
  width: number
  height: number
  active: boolean
  backgroundColor: string
  borderColor: string
  text: string
  textColor: string | null
  fontSize: number
}

interface TerminalRenderMetrics {
  offsetLeft: number
  offsetTop: number
  cellWidth: number
  cellHeight: number
  canvasWidth: number
}

function readCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function getPreferredTerminalAppearance(): TerminalAppearance {
  return {
    theme: {
      background: readCssVar('--ui-terminal-bg', '#000000'),
      foreground: readCssVar('--ui-terminal-fg', '#d7deea'),
      cursor: readCssVar('--ui-terminal-cursor', '#9bb4d8'),
      cursorAccent: readCssVar('--ui-terminal-cursor-accent', '#000000'),
      selectionBackground: readCssVar('--ui-terminal-selection-bg', '#2d5d91'),
      selectionForeground: readCssVar('--ui-terminal-selection-fg', '#eaf2ff'),
      selectionInactiveBackground: readCssVar('--ui-terminal-selection-bg', '#2d5d91')
    },
    search: {
      matchBackground: readCssVar('--ui-terminal-search-match-bg', '#19304b'),
      matchBorder: readCssVar('--ui-terminal-search-match-border', '#3b78b6'),
      activeMatchBackground: readCssVar('--ui-terminal-search-active-match-bg', '#315f94'),
      activeMatchBorder: readCssVar('--ui-terminal-search-active-match-border', '#5b90ca'),
      activeMatchForeground: readCssVar('--ui-terminal-search-active-match-fg', '#f5fbff')
    }
  }
}

function applyThemeToTerminal(terminal: XTermTerminal, appearance: TerminalAppearance): void {
  terminal.options.theme = appearance.theme
  terminal.refresh(0, Math.max(0, terminal.rows - 1))
}

function jumpToSearchResult(
  terminal: XTermTerminal,
  result: TerminalSearchResult,
  onComplete?: () => void
): void {
  const targetViewportLine = Math.max(0, result.line - Math.floor(terminal.rows / 2))
  terminal.scrollToLine(targetViewportLine)
  requestAnimationFrame(() => {
    terminal.scrollToLine(targetViewportLine)
    terminal.refresh(0, Math.max(0, terminal.rows - 1))
    onComplete?.()
  })
}

function buildSearchResults(terminal: XTermTerminal, rawQuery: string): TerminalSearchResult[] {
  const query = rawQuery.trim()
  if (!query) return []

  const normalizedQuery = query.toLocaleLowerCase()
  const results: TerminalSearchResult[] = []
  const buffer = terminal.buffer.active

  for (let lineIndex = buffer.length - 1; lineIndex >= 0; lineIndex--) {
    const line = buffer.getLine(lineIndex)
    const content = line?.translateToString(true) ?? ''
    if (!content) continue

    const normalizedContent = content.toLocaleLowerCase()
    let searchIndex = normalizedContent.lastIndexOf(normalizedQuery)
    while (searchIndex >= 0) {
      const beforeWords = content.slice(0, searchIndex).trim().split(/\s+/).filter(Boolean)
      const afterWords = content
        .slice(searchIndex + query.length)
        .trim()
        .split(/\s+/)
        .filter(Boolean)

      results.push({
        id: `${lineIndex}:${searchIndex}:${query.length}`,
        line: lineIndex,
        column: searchIndex,
        length: query.length,
        before: beforeWords.slice(-5).join(' '),
        beforeTruncated: beforeWords.length > 5,
        match: content.slice(searchIndex, searchIndex + query.length),
        after: afterWords.slice(0, 5).join(' '),
        afterTruncated: afterWords.length > 5
      })

      if (results.length >= MAX_SEARCH_RESULTS || searchIndex === 0) {
        break
      }

      searchIndex = normalizedContent.lastIndexOf(normalizedQuery, searchIndex - 1)
    }

    if (results.length >= MAX_SEARCH_RESULTS) {
      break
    }
  }

  return results
}

function getTerminalRenderMetrics(
  terminal: XTermTerminal,
  wrapper: HTMLDivElement | null
): TerminalRenderMetrics | null {
  const screen = terminal.element?.querySelector('.xterm-screen')
  if (!(screen instanceof HTMLElement) || !wrapper) return null

  const wrapperRect = wrapper.getBoundingClientRect()
  const screenRect = screen.getBoundingClientRect()
  if (screenRect.width <= 0 || screenRect.height <= 0 || terminal.cols <= 0 || terminal.rows <= 0) {
    return null
  }

  return {
    offsetLeft: screenRect.left - wrapperRect.left,
    offsetTop: screenRect.top - wrapperRect.top,
    cellWidth: screenRect.width / terminal.cols,
    cellHeight: screenRect.height / terminal.rows,
    canvasWidth: screenRect.width
  }
}

function buildOverlayHighlights(
  terminal: XTermTerminal,
  wrapper: HTMLDivElement | null,
  results: TerminalSearchResult[],
  activeResultId: string | null,
  appearance: TerminalSearchAppearance
): OverlayHighlight[] {
  const metrics = getTerminalRenderMetrics(terminal, wrapper)
  if (!metrics) return []

  const viewportY = terminal.buffer.active.viewportY
  const visibleRows = terminal.rows
  const highlights: OverlayHighlight[] = []

  for (const result of results) {
    const viewportRow = result.line - viewportY
    if (viewportRow < 0 || viewportRow >= visibleRows) continue
    if (result.column >= terminal.cols) continue

    const clampedWidthCells = Math.max(1, Math.min(result.length, terminal.cols - result.column))
    const left = metrics.offsetLeft + result.column * metrics.cellWidth
    const width = Math.min(clampedWidthCells * metrics.cellWidth, metrics.canvasWidth - result.column * metrics.cellWidth)
    if (width <= 0) continue

    const active = result.id === activeResultId
    highlights.push({
      id: result.id,
      left,
      top: metrics.offsetTop + viewportRow * metrics.cellHeight,
      width,
      height: metrics.cellHeight,
      active,
      backgroundColor: active ? appearance.activeMatchBackground : appearance.matchBackground,
      borderColor: active ? appearance.activeMatchBorder : appearance.matchBorder,
      text: result.match.slice(0, clampedWidthCells),
      textColor: active ? appearance.activeMatchForeground : null,
      fontSize: Math.max(
        11,
        Math.min(metrics.cellHeight * 0.78, (width / Math.max(1, clampedWidthCells)) * 1.75)
      )
    })
  }

  return highlights
}

function createOverlayKey(highlights: OverlayHighlight[]): string {
  return highlights
    .map((highlight) => {
      const left = highlight.left.toFixed(2)
      const top = highlight.top.toFixed(2)
      const width = highlight.width.toFixed(2)
      const height = highlight.height.toFixed(2)
      return [
        highlight.id,
        left,
        top,
        width,
        height,
        highlight.active ? '1' : '0',
        highlight.backgroundColor,
        highlight.borderColor,
        highlight.text,
        highlight.textColor ?? '',
        highlight.fontSize.toFixed(2)
      ].join(':')
    })
    .join('|')
}

export default function TerminalView({
  sessionId,
  isActive,
  scrollbackLines,
  isSearchOpen,
  searchScope,
  searchQuery,
  selectedSearchResultId,
  searchJumpNonce,
  onSearchResultsChange,
  onSelectedSearchResultChange
}: {
  sessionId: string
  isActive: boolean
  scrollbackLines: number
  isSearchOpen: boolean
  searchScope: 'current' | 'all'
  searchQuery: string
  selectedSearchResultId: string | null
  searchJumpNonce: number
  onSearchResultsChange: (results: TerminalSearchResult[]) => void
  onSelectedSearchResultChange: (resultId: string | null) => void
}): React.JSX.Element {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<XTermTerminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const appearanceRef = useRef<TerminalAppearance>(getPreferredTerminalAppearance())
  const isActiveRef = useRef(isActive)
  const searchStateRef = useRef({
    isSearchOpen,
    searchScope,
    searchQuery,
    selectedSearchResultId,
    searchJumpNonce
  })
  const callbacksRef = useRef({
    onSearchResultsChange,
    onSelectedSearchResultChange
  })
  const scheduleSearchSyncRef = useRef<() => void>(() => undefined)
  const lastResultsKeyRef = useRef<string>('')
  const lastOverlayKeyRef = useRef<string>('')
  const lastJumpKeyRef = useRef<string>('')
  const [overlayHighlights, setOverlayHighlights] = useState<OverlayHighlight[]>([])

  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

  useEffect(() => {
    searchStateRef.current = {
      isSearchOpen,
      searchScope,
      searchQuery,
      selectedSearchResultId,
      searchJumpNonce
    }
  }, [isSearchOpen, searchScope, searchQuery, selectedSearchResultId, searchJumpNonce])

  useEffect(() => {
    callbacksRef.current = {
      onSearchResultsChange,
      onSelectedSearchResultChange
    }
  }, [onSearchResultsChange, onSelectedSearchResultChange])

  useEffect(() => {
    let observer: ResizeObserver | null = null
    let mediaQuery: MediaQueryList | null = null
    let handleAppearanceChange: ((event: MediaQueryListEvent) => void) | null = null
    let removeData: (() => void) | null = null
    let removeExit: (() => void) | null = null
    let disposableData: IDisposable | null = null
    let disposableScroll: IDisposable | null = null
    let disposableResize: IDisposable | null = null
    let cancelled = false
    let scheduledSync = 0

    const terminal = new XTermTerminal({
      cursorBlink: true,
      convertEol: true,
      scrollback: scrollbackLines,
      fontFamily: 'Menlo, Monaco, Consolas, monospace',
      theme: appearanceRef.current.theme
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    const clearSearchUi = (resultsKey: string): void => {
      if (lastOverlayKeyRef.current !== '') {
        setOverlayHighlights([])
        lastOverlayKeyRef.current = ''
      }
      lastJumpKeyRef.current = ''
      if (lastResultsKeyRef.current !== resultsKey) {
        callbacksRef.current.onSearchResultsChange([])
        lastResultsKeyRef.current = resultsKey
      }
      if (searchStateRef.current.selectedSearchResultId !== null) {
        callbacksRef.current.onSelectedSearchResultChange(null)
      }
    }

    const syncSearchState = (): void => {
      const state = searchStateRef.current
      const { onSearchResultsChange: emitResults, onSelectedSearchResultChange: emitSelection } =
        callbacksRef.current
      const query = state.searchQuery.trim()
      const shouldSearch = state.isSearchOpen && (state.searchScope === 'all' || isActiveRef.current)

      if (!shouldSearch || !query) {
        clearSearchUi('')
        return
      }

      if (query.length < 2) {
        clearSearchUi('__min-query__')
        return
      }

      const results = buildSearchResults(terminal, query)
      const resultsKey = results.map((result) => result.id).join('|')
      if (resultsKey !== lastResultsKeyRef.current) {
        emitResults(results)
        lastResultsKeyRef.current = resultsKey
      }

      if (!isActiveRef.current) {
        if (lastOverlayKeyRef.current !== '') {
          setOverlayHighlights([])
          lastOverlayKeyRef.current = ''
        }
        lastJumpKeyRef.current = ''
        return
      }

      if (results.length === 0) {
        if (lastOverlayKeyRef.current !== '') {
          setOverlayHighlights([])
          lastOverlayKeyRef.current = ''
        }
        lastJumpKeyRef.current = ''
        if (state.selectedSearchResultId !== null) {
          emitSelection(null)
        }
        return
      }

      const activeResult =
        results.find((result) => result.id === state.selectedSearchResultId) ?? results[0] ?? null
      if (!activeResult) return

      if (activeResult.id !== state.selectedSearchResultId) {
        emitSelection(activeResult.id)
      }

      const nextHighlights = buildOverlayHighlights(
        terminal,
        wrapperRef.current,
        results,
        activeResult.id,
        appearanceRef.current.search
      )
      const overlayKey = createOverlayKey(nextHighlights)
      if (overlayKey !== lastOverlayKeyRef.current) {
        setOverlayHighlights(nextHighlights)
        lastOverlayKeyRef.current = overlayKey
      }

      const jumpKey = `${query}::${activeResult.id}::${state.searchJumpNonce}`
      if (jumpKey !== lastJumpKeyRef.current) {
        lastJumpKeyRef.current = jumpKey
        jumpToSearchResult(terminal, activeResult, () => scheduleSearchSync())
      }
    }

    const scheduleSearchSync = (): void => {
      if (scheduledSync) {
        window.clearTimeout(scheduledSync)
      }
      scheduledSync = window.setTimeout(() => {
        scheduledSync = 0
        if (cancelled) return
        syncSearchState()
      }, 0)
    }

    scheduleSearchSyncRef.current = scheduleSearchSync

    if (containerRef.current) {
      containerRef.current.replaceChildren()
      containerRef.current.style.backgroundColor = appearanceRef.current.theme.background ?? '#000000'
      terminal.open(containerRef.current)

      const fitNow = (): void => {
        fitAddon.fit()
        scheduleSearchSync()
        void window.api.resizeSession(sessionId, terminal.cols ?? 120, terminal.rows ?? 32)
      }

      fitNow()
      requestAnimationFrame(() => fitNow())
      window.setTimeout(() => fitNow(), 40)
      terminal.focus()
    }

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    scheduleSearchSync()

    mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
    handleAppearanceChange = () => {
      appearanceRef.current = getPreferredTerminalAppearance()
      if (containerRef.current) {
        containerRef.current.style.backgroundColor = appearanceRef.current.theme.background ?? '#000000'
      }
      applyThemeToTerminal(terminal, appearanceRef.current)
      scheduleSearchSync()
    }
    mediaQuery.addEventListener('change', handleAppearanceChange)

    removeData = window.api.onSessionData((payload) => {
      if (payload.sessionId !== sessionId) return
      terminal.write(payload.data, () => {
        if (cancelled) return
        scheduleSearchSync()
      })
    })

    removeExit = window.api.onSessionExit((payload) => {
      if (payload.sessionId !== sessionId) return
      terminal.writeln(`\r\n[session exited with code ${payload.code}]`, () => {
        if (cancelled) return
        scheduleSearchSync()
      })
    })

    disposableData = terminal.onData((value) => {
      void window.api.writeSessionInput(sessionId, value)
    })

    disposableScroll = terminal.onScroll(() => {
      scheduleSearchSync()
    })

    disposableResize = terminal.onResize(() => {
      scheduleSearchSync()
    })

    observer = new ResizeObserver(() => {
      fitAddon.fit()
      scheduleSearchSync()
      void window.api.resizeSession(sessionId, terminal.cols ?? 120, terminal.rows ?? 32)
    })

    if (containerRef.current) {
      observer.observe(containerRef.current)
      void window.api.resizeSession(sessionId, terminal.cols, terminal.rows)
    }

    return () => {
      cancelled = true
      if (scheduledSync) {
        window.clearTimeout(scheduledSync)
      }
      observer?.disconnect()
      if (mediaQuery && handleAppearanceChange) {
        mediaQuery.removeEventListener('change', handleAppearanceChange)
      }
      disposableData?.dispose()
      disposableScroll?.dispose()
      disposableResize?.dispose()
      removeData?.()
      removeExit?.()
      setOverlayHighlights([])
      lastOverlayKeyRef.current = ''
      terminal.dispose()
      if (containerRef.current) {
        containerRef.current.replaceChildren()
        containerRef.current.style.backgroundColor = ''
      }
      fitAddonRef.current = null
      terminalRef.current = null
    }
  }, [scrollbackLines, sessionId])

  useEffect(() => {
    scheduleSearchSyncRef.current()
  }, [isSearchOpen, searchScope, searchQuery, selectedSearchResultId, searchJumpNonce, isActive])

  useEffect(() => {
    if (!isActive) return
    const fitAddon = fitAddonRef.current
    const terminal = terminalRef.current
    if (!fitAddon || !terminal) return

    const resizeNow = (): void => {
      fitAddon.fit()
      terminal.refresh(0, Math.max(0, terminal.rows - 1))
      scheduleSearchSyncRef.current()
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

  return (
    <div className="terminal-view-shell" ref={wrapperRef}>
      <div className="terminal-view" ref={containerRef} />
      <div className="terminal-search-overlay" aria-hidden="true">
        {overlayHighlights.map((highlight) => (
          <div
            key={highlight.id}
            className={highlight.active ? 'terminal-search-highlight active' : 'terminal-search-highlight'}
            style={{
              left: `${highlight.left}px`,
              top: `${highlight.top}px`,
              width: `${highlight.width}px`,
              height: `${highlight.height}px`,
              backgroundColor: highlight.backgroundColor,
              borderColor: highlight.borderColor
            }}
          >
            {highlight.active && highlight.textColor ? (
              <span
                className="terminal-search-highlight-text"
                style={{
                  color: highlight.textColor,
                  fontSize: `${highlight.fontSize}px`,
                  lineHeight: `${highlight.height}px`
                }}
              >
                {highlight.text}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
