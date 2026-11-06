import type { Profile } from './types';
export const DOMESTIC_LEAGUES = ['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6'] as const;
/** The singular team remains the primary badge for existing ranking snapshots. */
export function supportedTeams(profile?: Pick<Profile,'team'|'teams'> | null): string[] {
  return [...new Set(profile?.teams ?? (profile?.team ? [profile.team] : []))];
}
export function supportsTeam(profile: Pick<Profile,'team'|'teams'> | null | undefined, team: string) {
  return supportedTeams(profile).includes(team);
}
export function canPostToClub(profile:Profile|null|undefined,team?:string) {
 return !!profile?.primaryTeam && (!team || profile.primaryTeam===team);
}
/** The server enforces the same KST calendar and once-per-league budget. */
export function supportWindow(at:number=Date.now()):string|null {
 const kst=new Date(at+9*3600000),month=kst.getUTCMonth()+1,day=kst.getUTCDate();
 return [2,9].includes(month)&&day<=7 ? `${kst.getUTCFullYear()}-${String(month).padStart(2,'0')}` : null;
}
export function canChangeSubteam(profile:Profile|null|undefined,league:string,at=Date.now()) {
 if(!profile)return true;
 const joined=Date.parse(profile.createdAt??'');
 if(Number.isFinite(joined)&&at>=joined&&at<joined+3600000)return true;
 const window=supportWindow(at);
 return !!window && (profile.supportChangeWindow!==window || !(profile.supportChangedLeagues??[]).includes(league));
}
