import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Server, Star } from 'lucide-react'
import type { HostEntry } from '../../../shared/types'

interface OpenHostSearchTab {
  id: string
  label: string
  lastActivatedAt: number
}

interface HostSearchPopupProps {
  hosts: HostEntry[]
  openTabs: OpenHostSearchTab[]
  onClose: () => void
  onOpenNew: (alias: string) => void | Promise<void>
  onSwitchRecent: (alias: string) => void | Promise<void>
}

interface RankedHost {
  host: HostEntry
  score: number
}

const MAX_RESULTS = 8

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function scoreText(query: string, candidate: string): number | null {
  const normalizedCandidate = normalize(candidate)
  if (!normalizedCandidate) return null

  if (normalizedCandidate === query) return 1400

  if (normalizedCandidate.startsWith(query)) {
    return 1200 - Math.min(normalizedCandidate.length - query.length, 120)
  }

  const containsIndex = normalizedCandidate.indexOf(query)
  if (containsIndex >= 0) {
    return 1000 - containsIndex * 5
  }

  let queryIndex = 0
  let score = 0
  let consecutiveMatches = 0

  for (let index = 0; index < normalizedCandidate.length && queryIndex < query.length; index++) {
    if (normalizedCandidate[index] !== query[queryIndex]) {
      consecutiveMatches = 0
      continue
    }

    score += consecutiveMatches > 0 ? 30 : 16
    consecutiveMatches += 1
    queryIndex += 1
  }

  if (queryIndex !== query.length) return null

  return 720 + score - (normalizedCandidate.length - query.length)
}

function rankHost(host: HostEntry, query: string, openTabCount: number): RankedHost | null {
  if (!query) {
    return {
      host,
      score:
        (host.isFavorite ? 80 : 0) +
        (openTabCount > 0 ? 40 + Math.min(openTabCount * 5, 20) : 0) +
        (host.effectiveGroupPath ? 5 : 0)
    }
  }

  const candidates = [
    host.alias,
    ...host.aliases,
    host.options.hostName,
    `${host.options.user}@${host.options.hostName}`,
    host.pingTarget
  ].filter(Boolean)

  let bestScore: number | null = null
  for (const candidate of candidates) {
    const score = scoreText(query, candidate)
    if (score === null) continue
    if (bestScore === null || score > bestScore) bestScore = score
  }

  if (bestScore === null) return null

  return {
    host,
    score: bestScore + (host.isFavorite ? 24 : 0) + (openTabCount > 0 ? 12 : 0)
  }
}

export default function HostSearchPopup({
  hosts,
  openTabs,
  onClose,
  onOpenNew,
  onSwitchRecent
}: HostSearchPopupProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const openTabCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const tab of openTabs) {
      counts.set(tab.label, (counts.get(tab.label) ?? 0) + 1)
    }
    return counts
  }, [openTabs])

  const recentOpenAliases = useMemo(() => {
    const entries = new Map<string, number>()
    const sortedTabs = [...openTabs].sort(
      (left, right) => right.lastActivatedAt - left.lastActivatedAt
    )
    sortedTabs.forEach((tab, index) => {
      if (!entries.has(tab.label)) {
        entries.set(tab.label, index)
      }
    })
    return entries
  }, [openTabs])

  const results = useMemo(() => {
    const normalizedQuery = normalize(query)
    const ranked = hosts
      .map((host) => rankHost(host, normalizedQuery, openTabCounts.get(host.alias) ?? 0))
      .filter((entry): entry is RankedHost => entry !== null)
      .sort((left, right) => {
        if (left.score !== right.score) return right.score - left.score

        const leftRecentRank = recentOpenAliases.get(left.host.alias) ?? Number.MAX_SAFE_INTEGER
        const rightRecentRank = recentOpenAliases.get(right.host.alias) ?? Number.MAX_SAFE_INTEGER
        if (leftRecentRank !== rightRecentRank) return leftRecentRank - rightRecentRank

        if (left.host.isFavorite !== right.host.isFavorite) return left.host.isFavorite ? -1 : 1

        return left.host.alias.localeCompare(right.host.alias)
      })
      .slice(0, MAX_RESULTS)

    if (normalizedQuery) return ranked

    return ranked.sort((left, right) => {
      const leftRecentRank = recentOpenAliases.get(left.host.alias) ?? Number.MAX_SAFE_INTEGER
      const rightRecentRank = recentOpenAliases.get(right.host.alias) ?? Number.MAX_SAFE_INTEGER
      if (leftRecentRank !== rightRecentRank) return leftRecentRank - rightRecentRank

      if (left.host.isFavorite !== right.host.isFavorite) return left.host.isFavorite ? -1 : 1

      return left.host.alias.localeCompare(right.host.alias)
    })
  }, [hosts, openTabCounts, query, recentOpenAliases])

  const clampedSelectedIndex =
    results.length === 0 ? 0 : Math.min(selectedIndex, results.length - 1)
  const selectedResult = results[clampedSelectedIndex] ?? null
  const topResult = results[0] ?? null
  const topResultOpenTabCount = topResult ? (openTabCounts.get(topResult.host.alias) ?? 0) : 0

  useEffect(() => {
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const activateAlias = (alias: string, useExistingTab: boolean): void => {
    if (useExistingTab && (openTabCounts.get(alias) ?? 0) > 0) {
      void onSwitchRecent(alias)
      return
    }

    void onOpenNew(alias)
  }

  const activateSelection = (useExistingTab: boolean): void => {
    if (!selectedResult) return
    activateAlias(selectedResult.host.alias, useExistingTab)
  }

  return (
    <div className="host-search-overlay" onClick={onClose}>
      <div className="host-search-modal" onClick={(event) => event.stopPropagation()}>
        <div className="host-search-header">
          <div className="host-search-input-wrap">
            <Search size={16} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSelectedIndex(0)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setSelectedIndex((current) =>
                    results.length === 0 ? 0 : Math.min(current + 1, results.length - 1)
                  )
                  return
                }

                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setSelectedIndex((current) => Math.max(current - 1, 0))
                  return
                }

                if (event.key === 'Enter') {
                  event.preventDefault()
                  activateSelection(event.shiftKey)
                }
              }}
              placeholder="Search hosts by name, alias, or IP"
              spellCheck={false}
            />
          </div>
          {topResultOpenTabCount > 0 ? (
            <div className="host-search-shift-hint">Shift+Enter to switch to open tab</div>
          ) : null}
        </div>

        <div className="host-search-results">
          {results.length > 0 ? (
            results.map((result, index) => {
              const openTabCount = openTabCounts.get(result.host.alias) ?? 0
              const secondaryLabel =
                result.host.aliases[0] && result.host.aliases[0] !== result.host.alias
                  ? result.host.aliases[0]
                  : null

              return (
                <button
                  key={result.host.alias}
                  className={
                    index === clampedSelectedIndex
                      ? 'host-search-result active'
                      : 'host-search-result'
                  }
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => activateAlias(result.host.alias, false)}
                >
                  <div className="host-search-result-icon">
                    <Server size={15} />
                  </div>
                  <div className="host-search-result-body">
                    <div className="host-search-result-title-row">
                      <span className="host-search-result-title">{result.host.alias}</span>
                      {secondaryLabel ? (
                        <span className="host-search-result-secondary">{secondaryLabel}</span>
                      ) : null}
                    </div>
                    <div className="host-search-result-meta">
                      <span>
                        {result.host.options.user ? `${result.host.options.user}@` : ''}
                        {result.host.options.hostName || result.host.pingTarget || 'Unknown host'}
                      </span>
                      <span>{result.host.effectiveGroupPath ?? 'Global'}</span>
                    </div>
                  </div>
                  <div className="host-search-result-badges">
                    {result.host.isFavorite ? (
                      <span className="host-search-badge favorite-badge">
                        <Star size={12} />
                        Favorite
                      </span>
                    ) : null}
                    {openTabCount > 0 ? (
                      <span className="host-search-badge open-badge">
                        Open {openTabCount > 1 ? `(${openTabCount})` : ''}
                      </span>
                    ) : null}
                  </div>
                </button>
              )
            })
          ) : (
            <div className="host-search-empty">
              No hosts matched <span>{query}</span>
            </div>
          )}
        </div>

        <div className="host-search-footer">
          <span>Enter opens a new tab</span>
          <span>Esc closes</span>
        </div>
      </div>
    </div>
  )
}
