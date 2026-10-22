export type EsportsMatchStatus = 'upcoming' | 'live' | 'completed';

export interface EsportsTeam {
  id: string;
  name: string;
  shortName: string;
  image: string | null;
}

export interface EsportsMatch {
  id: string;
  startAt: string;
  status: EsportsMatchStatus;
  eventName: string;
  eventTier: string;
  region: string;
  bestOf: number;
  home: EsportsTeam;
  away: EsportsTeam;
  homeScore: number | null;
  awayScore: number | null;
}

export interface EsportsEvent {
  id: string;
  name: string;
  region: string;
  tier: string;
  status: 'ongoing' | 'upcoming' | 'completed';
  startDate: string;
  endDate: string;
  teamsCount: number;
}
