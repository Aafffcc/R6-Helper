import { getCatalogImageUrl, getTeams } from '@/services/catalog';
import type { EsportsEvent, EsportsMatch, EsportsTeam } from '@/types/esports';

function findTeam(id: string, shortName: string): EsportsTeam {
  const entry = getTeams().find((item) => item.id === id);
  return {
    id,
    name: entry?.name ?? shortName,
    shortName,
    image: entry === undefined ? null : getCatalogImageUrl(entry, 'teams'),
  };
}

export const DEMO_ESPORTS_EVENTS: EsportsEvent[] = [
  {
    id: 'six-invitational-2026',
    name: 'Six Invitational 2026',
    region: '全球',
    tier: 'S-Tier',
    status: 'upcoming',
    startDate: '2026-02-10',
    endDate: '2026-02-22',
    teamsCount: 20,
  },
  {
    id: 'blast-r6-major-2026',
    name: 'BLAST R6 Major 2026',
    region: '全球',
    tier: 'S-Tier',
    status: 'ongoing',
    startDate: '2026-05-18',
    endDate: '2026-06-07',
    teamsCount: 16,
  },
  {
    id: 'cn-league-2026-stage-3',
    name: 'CN League 2026 · Stage 3',
    region: '中国',
    tier: 'A-Tier',
    status: 'ongoing',
    startDate: '2026-09-01',
    endDate: '2026-11-15',
    teamsCount: 8,
  },
];

export const DEMO_ESPORTS_MATCHES: EsportsMatch[] = [
  {
    id: 'match-001',
    startAt: '2026-10-24T19:00:00+08:00',
    status: 'upcoming',
    eventName: 'CN League 2026 · Stage 3',
    eventTier: 'A-Tier',
    region: '中国',
    bestOf: 3,
    home: findTeam('edward-gaming', 'EDG'),
    away: findTeam('all-gamers', 'AG'),
    homeScore: null,
    awayScore: null,
  },
  {
    id: 'match-002',
    startAt: '2026-10-25T21:00:00+08:00',
    status: 'upcoming',
    eventName: 'BLAST R6 Major 2026',
    eventTier: 'S-Tier',
    region: '全球',
    bestOf: 3,
    home: findTeam('darkzero', 'DZ'),
    away: findTeam('cloud9', 'C9'),
    homeScore: null,
    awayScore: null,
  },
  {
    id: 'match-003',
    startAt: '2026-10-22T18:00:00+08:00',
    status: 'completed',
    eventName: 'Europe & MENA League',
    eventTier: 'A-Tier',
    region: '欧洲 / MENA',
    bestOf: 3,
    home: findTeam('g2-esports', 'G2'),
    away: findTeam('enterprise-esports', 'ENT'),
    homeScore: 2,
    awayScore: 1,
  },
];

export function getEsportsEvents(): EsportsEvent[] {
  return DEMO_ESPORTS_EVENTS;
}

export function getEsportsMatches(): EsportsMatch[] {
  return DEMO_ESPORTS_MATCHES;
}

export function getFeaturedEsportsTeams(): EsportsTeam[] {
  return getTeams()
    .slice(0, 8)
    .map((team) => ({
      id: team.id,
      name: team.name,
      shortName: team.name
        .split(' ')
        .map((token) => token[0])
        .join('')
        .slice(0, 3)
        .toUpperCase(),
      image: getCatalogImageUrl(team, 'teams'),
    }));
}
