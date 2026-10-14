import { readAllNames, insertMissingPlayerNames } from './korean-catalog.mjs';
import { hasKoreanName, transliteratePlayerName } from './player-transliteration.mjs';
import { checked } from './automatic-football.mjs';

export async function readNameCoverage(db) {
  let columns=true;
  let players;
  try { players=await readAllNames(db,'players','id,name,english,birth_date,provider,team_id,name_ko'); }
  catch (error) {
    if (!['42703','PGRST204'].includes(error.code)) throw error;
    columns=false; players=await readAllNames(db,'players','id,name,english,birth_date,provider,team_id');
  }
  const names=await readAllNames(db,'player_names','player_id,display_name,source');
  const byId=new Map(names.map(n=>[n.player_id,n]));
  const missing=players.filter(p=>p.provider==='bsd'&&!hasKoreanName(p.name_ko)&&!hasKoreanName(byId.get(p.id)?.display_name));
  return { players,names,columns,missing,summary:{totalPlayers:players.length,bsdPlayers:players.filter(p=>p.provider==='bsd').length,nameColumnsAvailable:columns,
    koreanNames:players.filter(p=>p.provider==='bsd'&&(hasKoreanName(p.name_ko)||hasKoreanName(byId.get(p.id)?.display_name))).length,
    missing:missing.length,missingBirthDate:missing.filter(p=>!p.birth_date).length,
    missingCurrentTeam:missing.filter(p=>!p.team_id).length,
    columnSyncPending:columns?players.filter(p=>p.provider==='bsd'&&!hasKoreanName(p.name_ko)&&hasKoreanName(byId.get(p.id)?.display_name)).length:null} };
}

export function planMissingKoreanNames(coverage,{limit=10000}={}) {
  const existing=new Map(coverage.names.map(n=>[n.player_id,n]));
  const rows=[],unresolved=[];
  for (const p of coverage.missing) {
    if (rows.length>=limit) break;
    // Preserve even non-Hangul explicit labels; report instead of overwriting them.
    if (existing.has(p.id)) { unresolved.push({id:p.id,reason:'existing_label_preserved'}); continue; }
    const label=transliteratePlayerName(p);
    if (!label) { unresolved.push({id:p.id,name:p.name,reason:'unsupported_spelling'}); continue; }
    rows.push({id:p.id,name:p.name,name_ko:label,...(p.birth_date?{birth_date:p.birth_date}:{}),source:'transliteration',review:'provisional'});
  }
  return {rows,unresolved};
}

/** Insert-only atomic RPC verifies current ID/name/DOB and protects concurrent overrides.
 * The existing alias trigger fills players.name_ko without changing the source. */
export async function fillMissingKoreanNames(db,{apply=false,limit=10000,emit=()=>{}}={}) {
  const before=await readNameCoverage(db),plan=planMissingKoreanNames(before,{limit});
  emit({stage:'korean-name-audit',...before.summary,planned:plan.rows.length,unresolved:plan.unresolved,sample:plan.rows.slice(0,20)});
  let inserted=0,repaired=0;
  if (apply) {
    for(let start=0;start<plan.rows.length;start+=200) {
      const batch=plan.rows.slice(start,start+200);
      const result=await db.rpc('kickx_apply_korean_catalog',{p_players:batch,p_teams:[]});
      if(result.error?.code==='PGRST202') {
        // A legacy schema lacks source-row CAS; recheck identity immediately before insertion.
        const current=await readNameCoverage(db),byId=new Map(current.players.map(p=>[p.id,p]));
        const names=new Set(current.names.map(n=>n.player_id));
        const safe=batch.filter(r=>{const p=byId.get(r.id);return p?.provider==='bsd'&&p.name===r.name&&(!r.birth_date||p.birth_date===r.birth_date)&&!names.has(r.id)&&!hasKoreanName(p.name_ko);});
        inserted+=await insertMissingPlayerNames(db,safe.map(r=>({player_id:r.id,display_name:r.name_ko,aliases:[r.name],source:'transliteration',source_id:null})));
      } else inserted+=checked(result)?.players??0;
    }
    if (before.columns) {
      const byId=new Map(before.names.map(n=>[n.player_id,n]));
      for(const p of before.players.filter(p=>p.provider==='bsd'&&!hasKoreanName(p.name_ko))) {
        const n=byId.get(p.id);if(!hasKoreanName(n?.display_name))continue;
        // Re-run the alias trigger with a value/source CAS. No manual source conversion.
        const result=await db.from('player_names').update({display_name:n.display_name}).eq('player_id',p.id).eq('display_name',n.display_name).eq('source',n.source).select('player_id');
        repaired+=checked(result)?.length??0;
      }
    }
  }
  const after=apply?await readNameCoverage(db):before;
  const summary={mode:apply?'apply':'dry-run',before:before.summary,after:after.summary,inserted,repaired,planned:plan.rows.length,unresolved:plan.unresolved};
  emit({stage:'korean-name-result',...summary});return summary;
}
