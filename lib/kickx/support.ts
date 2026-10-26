import type { Profile } from './types';
export const DOMESTIC_LEAGUES = ['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6'] as const;
/** The singular team remains the primary badge for existing ranking snapshots. */
export function supportedTeams(profile?: Pick<Profile,'team'|'teams'> | null): string[] {
  return [...new Set(profile?.teams ?? (profile?.team ? [profile.team] : []))];
}
export function supportsTeam(profile: Pick<Profile,'team'|'teams'> | null | undefined, team: string) {
  return supportedTeams(profile).includes(team);
}
