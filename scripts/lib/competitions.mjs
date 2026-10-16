export const DOMESTIC_LEAGUE_IDS = [1, 3, 4, 5, 6];
const normalize = name => String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Resolve IDs from the provider, never reuse IDs from another football API.
export const CLUB_COMPETITIONS = [
  ['챔피언스리그', ['Champions League', 'UEFA Champions League']],
  ['유로파리그', ['Europa League', 'UEFA Europa League']],
  ['컨퍼런스리그', ['Conference League', 'UEFA Conference League', 'UEFA Europa Conference League']],
  ['UEFA 슈퍼컵', ['UEFA Super Cup']],
  ['FA컵', ['FA Cup']], ['카라바오컵', ['Carabao Cup', 'EFL Cup']],
  ['코파 델 레이', ['Copa del Rey']], ['코파 이탈리아', ['Coppa Italia']],
  ['DFB 포칼', ['DFB Pokal', 'DFB-Pokal']], ['쿠프 드 프랑스', ['Coupe de France']],
  ['커뮤니티 실드', ['Community Shield', 'FA Community Shield']],
  ['수페르코파 데 에스파냐', ['Supercopa de España', 'Supercopa de Espana']],
  ['이탈리아 슈퍼컵', ['Supercoppa Italiana']],
  ['독일 슈퍼컵', ['DFL Supercup', 'German Super Cup', 'Franz-Beckenbauer-Supercup']],
  ['트로페 데 샹피옹', ['Trophée des Champions', 'Trophee des Champions']],
  ['FIFA 클럽월드컵', ['FIFA Club World Cup', 'Club World Cup']],
  ['FIFA 인터컨티넨털컵', ['FIFA Intercontinental Cup']],
];
export function resolveClubCompetitions(leagues) {
  const found = [], missing = [];
  for (const [name, aliases] of CLUB_COMPETITIONS) {
    const matches = leagues.filter(l => l.is_women!==true && aliases.some(a => normalize(a) === normalize(l.name)));
    if (matches.length > 1) throw new Error('AMBIGUOUS_COMPETITION');
    const l = matches[0];
    if (!l) { missing.push(name); continue; }
    if (!Number.isSafeInteger(l.id) || l.id < 1 || DOMESTIC_LEAGUE_IDS.includes(l.id) || found.some(x => x.id === l.id)) throw new Error('INVALID_COMPETITION');
    found.push({id:l.id,name,providerName:l.name});
  }
  return {found,missing};
}
export async function discoverClubCompetitions(api) {
  const leagues=[];let offset=0;
  do {const page=await api.page('/api/v2/leagues/',{limit:200,offset});leagues.push(...page.results);offset=page.next;if(leagues.length>2000)throw new Error('COMPETITION_LIST_TOO_LARGE');}while(offset!=null);
  return resolveClubCompetitions(leagues);
}
