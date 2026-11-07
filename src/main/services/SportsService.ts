import type { SecureStore } from './SecureStore'

const ROOT = 'https://api.the-odds-api.com/v4'
const CACHE_MS = 60_000

interface Sport {
  key: string
  title: string
  terms: string[]
}

const SPORTS: Sport[] = [
  { key: 'basketball_nba', title: 'NBA', terms: ['nba', 'basketball', 'lakers', 'celtics', 'warriors', 'knicks', 'bulls', 'heat', 'mavericks', 'spurs', 'nuggets', 'suns', 'bucks', 'sixers', '76ers', 'thunder', 'timberwolves', 'clippers', 'cavaliers', 'raptors'] },
  { key: 'americanfootball_nfl', title: 'NFL', terms: ['nfl', 'football', 'chiefs', 'eagles', 'cowboys', '49ers', 'niners', 'packers', 'bills', 'ravens', 'lions', 'bengals', 'dolphins', 'steelers', 'patriots', 'seahawks', 'vikings'] },
  { key: 'baseball_mlb', title: 'MLB', terms: ['mlb', 'baseball', 'yankees', 'mets', 'dodgers', 'red sox', 'cubs', 'braves', 'astros', 'padres', 'giants', 'phillies', 'blue jays'] },
  { key: 'icehockey_nhl', title: 'NHL', terms: ['nhl', 'hockey', 'maple leafs', 'bruins', 'rangers', 'oilers', 'canucks', 'avalanche', 'golden knights', 'penguins', 'blackhawks', 'red wings'] },
  { key: 'soccer_epl', title: 'English Premier League', terms: ['premier league', 'epl', 'man city', 'manchester city', 'arsenal', 'liverpool', 'chelsea', 'tottenham', 'spurs', 'man united', 'manchester united'] },
  { key: 'soccer_usa_mls', title: 'MLS', terms: ['mls', 'major league soccer', 'inter miami', 'la galaxy', 'sounders'] },
  { key: 'soccer_uefa_champs_league', title: 'UEFA Champions League', terms: ['champions league', 'ucl', 'real madrid', 'barcelona', 'bayern', 'psg', 'juventus', 'ac milan', 'inter milan'] }
]

interface OddsEvent {
  home_team?: unknown
  away_team?: unknown
  commence_time?: unknown
  completed?: unknown
  scores?: unknown
  last_update?: unknown
}

interface ScoreAnswer {
  handled: boolean
  text?: string
  error?: string
}

export class SportsService {
  private cache = new Map<string, { expiresAt: number; events: OddsEvent[] }>()

  constructor(private secure: SecureStore) {}

  hasApiKey(): boolean {
    return this.secure.hasApiKey()
  }

  hint(): string | null {
    return this.secure.hint()
  }

  setApiKey(key: string): void {
    this.secure.write(key)
  }

  clearApiKey(): void {
    this.secure.clear()
  }

  async answer(question: string, signal: AbortSignal): Promise<ScoreAnswer> {
    const sport = inferSport(question)
    if (!isScoreQuestion(question)) return { handled: false }
    if (!sport) return { handled: true, error: 'For a live score, name a supported league or team (for example, “Lakers score” or “Arsenal score”).' }
    const apiKey = this.secure.read()
    if (!apiKey) return { handled: true, error: 'Add your The Odds API key in Settings → AI to look up live scores.' }
    try {
      const events = await this.events(sport, apiKey, signal)
      const matches = filterEvents(events, question)
      if (matches.length === 0) return { handled: true, text: `No current or recently completed ${sport.title} game matched that request.` }
      return { handled: true, text: `${sport.title} scores\n\n${matches.slice(0, 5).map(formatEvent).join('\n')}` }
    } catch (error) {
      return { handled: true, error: explainOddsError(error) }
    }
  }

  private async events(sport: Sport, apiKey: string, signal: AbortSignal): Promise<OddsEvent[]> {
    const cached = this.cache.get(sport.key)
    if (cached && cached.expiresAt > Date.now()) return cached.events
    const url = new URL(`${ROOT}/sports/${encodeURIComponent(sport.key)}/scores/`)
    url.searchParams.set('apiKey', apiKey)
    url.searchParams.set('daysFrom', '3')
    url.searchParams.set('dateFormat', 'iso')
    const response = await fetch(url, { signal })
    if (!response.ok) throw new OddsError(response.status, await oddsErrorMessage(response))
    const body = await response.json() as unknown
    if (!Array.isArray(body)) throw new Error('The Odds API returned an unexpected score response.')
    this.cache.set(sport.key, { expiresAt: Date.now() + CACHE_MS, events: body as OddsEvent[] })
    return body as OddsEvent[]
  }
}

export function isScoreQuestion(question: string): boolean {
  return /\b(score|scores|scored|result|results|live|playing|game|match|versus|vs)\b/i.test(question)
}

export function inferSport(question: string): Sport | null {
  const lower = question.toLowerCase()
  return SPORTS.find((sport) => sport.terms.some((term) => lower.includes(term))) ?? null
}

export function filterEvents(events: OddsEvent[], question: string): OddsEvent[] {
  const lower = question.toLowerCase()
  const matchup = parseMatchup(lower)
  if (matchup) {
    return events.filter((event) => {
      if (typeof event.home_team !== 'string' || typeof event.away_team !== 'string') return false
      return (questionNamesTeam(matchup.left, event.home_team) && questionNamesTeam(matchup.right, event.away_team))
        || (questionNamesTeam(matchup.left, event.away_team) && questionNamesTeam(matchup.right, event.home_team))
    })
  }
  const named = events.filter((event) => [event.home_team, event.away_team].some((team) => typeof team === 'string' && questionNamesTeam(lower, team)))
  return named.length > 0 ? named : events.filter((event) => event.scores != null || event.completed === true)
}

function parseMatchup(question: string): { left: string; right: string } | null {
  const match = question.match(/^\s*(.+?)\s+(?:vs\.?|versus)(?=\s|$)\s+(.+?)\s*$/i)
  if (!match) return null
  return { left: match[1], right: match[2] }
}

/** A user normally asks for “Bulls vs Knicks”, not the full franchise names returned by the API. */
function questionNamesTeam(question: string, team: string): boolean {
  return team
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
    .some((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(question))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatEvent(event: OddsEvent): string {
  const home = typeof event.home_team === 'string' ? event.home_team : 'Home'
  const away = typeof event.away_team === 'string' ? event.away_team : 'Away'
  const scores = Array.isArray(event.scores) ? event.scores : []
  const score = scores
    .filter((item): item is { name?: unknown; score?: unknown } => Boolean(item) && typeof item === 'object')
    .map((item) => `${typeof item.name === 'string' ? item.name : 'Team'} ${typeof item.score === 'string' || typeof item.score === 'number' ? item.score : '—'}`)
    .join(' — ')
  if (score) return `• ${score}${event.completed === true ? ' (Final)' : ''}`
  const date = typeof event.commence_time === 'string' ? new Date(event.commence_time) : null
  const when = date && !Number.isNaN(date.valueOf()) ? date.toLocaleString() : 'scheduled'
  return `• ${away} at ${home} — ${when}`
}

class OddsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function oddsErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: unknown }
    return typeof body.message === 'string' ? body.message.slice(0, 200) : `The Odds API request failed (${response.status}).`
  } catch {
    return `The Odds API request failed (${response.status}).`
  }
}

function explainOddsError(error: unknown): string {
  if (error instanceof OddsError) {
    if (error.status === 401 || error.status === 403) return 'The Odds API key was rejected. Update it in Settings → AI.'
    if (error.status === 429) return 'The Odds API rate limit was reached. Wait a minute, then retry.'
    return error.message
  }
  if (error instanceof Error && error.name === 'AbortError') return 'Cancelled.'
  return 'The live-score lookup failed. Please retry.'
}
