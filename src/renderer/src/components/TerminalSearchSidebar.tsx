import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { TerminalSearchResult } from './TerminalView'

export type TerminalSearchScope = 'current' | 'all'

export interface TerminalSearchSidebarResult extends TerminalSearchResult {
  globalId: string
  tabId: string
  tabLabel: string
  isCurrentTab: boolean
}

interface TerminalSearchSidebarProps {
  query: string
  scope: TerminalSearchScope
  results: TerminalSearchSidebarResult[]
  selectedResultId: string | null
  focusNonce: number
  onQueryChange: (value: string) => void
  onScopeChange: (value: TerminalSearchScope) => void
  onSelectResult: (resultId: string, tabId: string) => void
  onClose: () => void
}

export default function TerminalSearchSidebar({
  query,
  scope,
  results,
  selectedResultId,
  focusNonce,
  onQueryChange,
  onScopeChange,
  onSelectResult,
  onClose
}: TerminalSearchSidebarProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draftQuery, setDraftQuery] = useState(query)

  const selectedIndex = useMemo(() => {
    if (!selectedResultId) return results.length > 0 ? 0 : -1
    return results.findIndex((result) => result.globalId === selectedResultId)
  }, [results, selectedResultId])

  useEffect(() => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [focusNonce])

  useEffect(() => {
    setDraftQuery(query)
  }, [query])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (draftQuery === query) return
      onQueryChange(draftQuery)
    }, 140)

    return () => window.clearTimeout(handle)
  }, [draftQuery, onQueryChange, query])

  const moveSelection = (offset: number): void => {
    if (results.length === 0) return
    const currentIndex = selectedIndex < 0 ? 0 : selectedIndex
    const nextIndex = Math.max(0, Math.min(results.length - 1, currentIndex + offset))
    const next = results[nextIndex]
    if (next) {
      onSelectResult(next.globalId, next.tabId)
    }
  }

  return (
    <aside className="terminal-search-sidebar">
      <div className="terminal-search-sidebar-header">
        <div className="terminal-search-input-wrap">
          <Search size={16} />
          <input
            ref={inputRef}
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                moveSelection(1)
                return
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault()
                moveSelection(-1)
                return
              }

              if (event.key === 'Enter') {
                event.preventDefault()
                if (results.length === 0) return
                const next = results[Math.max(0, selectedIndex)] ?? results[0]
                if (next) {
                  onSelectResult(next.globalId, next.tabId)
                }
                return
              }

              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              }
            }}
            placeholder="Search terminal output"
            spellCheck={false}
          />
        </div>
        <button className="terminal-search-close clickable" onClick={onClose} title="Close search">
          <X size={14} />
        </button>
      </div>

      <div className="terminal-search-scope-toggle" role="tablist" aria-label="Search scope">
        <button
          type="button"
          className={
            scope === 'current'
              ? 'terminal-search-scope-option active clickable'
              : 'terminal-search-scope-option clickable'
          }
          onClick={() => onScopeChange('current')}
        >
          Current Tab
        </button>
        <button
          type="button"
          className={
            scope === 'all'
              ? 'terminal-search-scope-option active clickable'
              : 'terminal-search-scope-option clickable'
          }
          onClick={() => onScopeChange('all')}
        >
          All Tabs
        </button>
      </div>

      <div className="terminal-search-summary">
        {draftQuery.trim().length === 1
          ? 'Type one more character to search'
          : query.trim()
            ? `${results.length} hit${results.length === 1 ? '' : 's'}`
            : scope === 'all'
              ? 'Type to search across open tabs'
              : 'Type to search the active terminal'}
      </div>

      <div className="terminal-search-results">
        {query.trim() && results.length === 0 ? (
          <div className="terminal-search-empty">No matches found</div>
        ) : null}

        {results.map((result, index) => {
          const isSelected =
            result.globalId === selectedResultId || (!selectedResultId && results[0]?.globalId === result.globalId)
          const previous = index > 0 ? results[index - 1] : null
          const startsNewTabGroup = scope === 'all' && !!previous && previous.tabId !== result.tabId
          return (
            <div
              key={result.globalId}
              className={
                startsNewTabGroup
                  ? 'terminal-search-result-group terminal-search-result-group-separated'
                  : 'terminal-search-result-group'
              }
            >
              <button
                className={isSelected ? 'terminal-search-result active' : 'terminal-search-result'}
                onClick={() => onSelectResult(result.globalId, result.tabId)}
              >
                <div className="terminal-search-result-meta">
                  <span>Line {result.line + 1}</span>
                  {scope === 'all' ? (
                    <span
                      className={
                        result.isCurrentTab
                          ? 'terminal-search-result-tab terminal-search-result-tab-current'
                          : 'terminal-search-result-tab'
                      }
                    >
                      {result.tabLabel}
                    </span>
                  ) : null}
                </div>
                <div className="terminal-search-result-text">
                  {result.before ? (
                    <span className="terminal-search-context before">
                      {result.beforeTruncated ? '... ' : ''}
                      {result.before}
                      {' '}
                    </span>
                  ) : null}
                  <mark>{result.match}</mark>
                  {result.after ? (
                    <span className="terminal-search-context after">
                      {' '}
                      {result.after}
                      {result.afterTruncated ? ' ...' : ''}
                    </span>
                  ) : null}
                </div>
              </button>
            </div>
          )
        })}
      </div>

      <div className="terminal-search-footer">
        <span>{scope === 'all' ? 'Current tab is listed first' : 'Latest hit stays selected'}</span>
        <span>Esc closes</span>
      </div>
    </aside>
  )
}
