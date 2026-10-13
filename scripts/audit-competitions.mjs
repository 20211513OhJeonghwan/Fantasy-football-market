// Read-only provider audit. Never prints credentials or writes production data.
import { createFootballClient } from './lib/football.mjs';
const api=createFootballClient({key:process.env.BSD_API_KEY,budget:100});
const all=[];let offset=0;
do {const p=await api.page('/api/v2/leagues/',{limit:200,offset});all.push(...p.results);offset=p.next;}while(offset!=null);
const names=/premier league|la liga|serie a|bundesliga|ligue 1|champions league|europa league|conference league|super cup|supercup|supercopa|coppa italia|copa del rey|dfb|fa cup|carabao|coupe de france|community shield|trophée|club world/i;
for(const l of all.filter(l=>names.test(l.name))){
 console.log(JSON.stringify({competition:l}));
 const season=await api.get(`/api/v2/leagues/${l.id}/season/`);
 console.log(JSON.stringify({league:l.id,season}));
 if(!season.season || [1,3,4,5,6].includes(l.id))continue;
 const p=await api.page('/api/v2/events/',{league_id:l.id,season_id:season.season.id,status:'finished',limit:3,offset:0});
 console.log(JSON.stringify({league:l.id,finished:p.count,examples:p.results}));
 if(p.results[0]){
  const id=p.results[0].id;
  const availability=await api.get(`/api/v2/events/${id}/availability/`);
  const incidents=await api.get(`/api/v2/events/${id}/incidents/`);
  console.log(JSON.stringify({league:l.id,id,availability,incidents:incidents.incidents.slice(-15)}));
 }
}
