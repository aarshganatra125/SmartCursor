import { describe, expect, it } from 'vitest'
import { filterEvents, inferSport, isScoreQuestion } from '../src/main/services/SportsService'

describe('sports score routing', () => {
  it('routes a team score question to its league provider', () => {
    expect(isScoreQuestion("What's the Lakers score?")).toBe(true)
    expect(inferSport("What's the Lakers score?")?.key).toBe('basketball_nba')
  })

  it('recognizes a team-versus-team matchup as a score request', () => {
    expect(isScoreQuestion('Bulls vs Knicks')).toBe(true)
    expect(inferSport('Bulls vs Knicks')?.key).toBe('basketball_nba')
  })

  it('matches a requested team against the full franchise name returned by the provider', () => {
    const events = [
      { home_team: 'Washington Wizards', away_team: 'Atlanta Hawks', completed: true },
      { home_team: 'New York Knicks', away_team: 'Chicago Bulls', completed: true },
      { home_team: 'New York Knicks', away_team: 'Cleveland Cavaliers', completed: false },
      { home_team: 'San Antonio Spurs', away_team: 'New York Knicks', completed: false }
    ]
    expect(filterEvents(events, 'Bulls vs Knicks')).toEqual([events[1]])
  })

  it('routes a soccer team to its supported competition', () => {
    expect(inferSport('Is Arsenal playing live?')?.key).toBe('soccer_epl')
  })

  it('does not take ordinary chat through the sports provider', () => {
    expect(isScoreQuestion('Rewrite this email')).toBe(false)
  })
})
