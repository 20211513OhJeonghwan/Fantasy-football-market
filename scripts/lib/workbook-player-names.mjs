import { readAllNames } from './korean-catalog.mjs';

export const normalizePlayerIdentity = value => (value ?? '').normalize('NFKD').replace(/\p{M}/gu, '')
  .replace(/[đð]/gi, 'd').replace(/[ø]/gi, 'o').replace(/[ł]/gi, 'l').replace(/ß/g, 'ss')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const compact = value => normalizePlayerIdentity(value).replaceAll(' ', '');
const teamKey = value => normalizePlayerIdentity(value).split(' ').filter(token => !['fc','afc','cf','sc','sco','rc','ac','as','ssc','ud','cd','bc'].includes(token)).join(' ');
const equalName = (left, right) => compact(left) !== '' && compact(left) === compact(right);
const variants = player => [player.name, player.english, player.short_name].filter(Boolean);
const sameDay = (left, right) => !!left && !!right && left === right;
const korean = value => typeof value === 'string' && value === value.trim() && value.length <= 80 && /[가-힣]/u.test(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export function validateWorkbookNames(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.version) || !Array.isArray(data.players) || data.players.length > 10000) throw new Error('INVALID_WORKBOOK_NAMES');
  const keys = new Set();
  for (const row of data.players) {
    if (typeof row.key !== 'string' || keys.has(row.key) || !row.name?.trim() || !row.team?.trim()
      || (row.name_ko != null && row.name_ko !== '' && !korean(row.name_ko))
      || (row.birth_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(row.birth_date))
      || !Array.isArray(row.aliases) || row.aliases.some(alias => typeof alias !== 'string' || alias.length > 80)) throw new Error('INVALID_WORKBOOK_NAMES');
    keys.add(row.key);
  }
  const overrides = new Set();
  for (const row of data.identity_overrides ?? []) {
    if (!keys.has(row.key) || overrides.has(row.key) || !/^bsd-\d+$/.test(row.id) || !row.expected_name || !row.birth_date) throw new Error('INVALID_WORKBOOK_IDENTITY_OVERRIDE');
    overrides.add(row.key);
  }
  return data;
}

function compatibleFullName(left, right) {
  const a = normalizePlayerIdentity(left).split(' '), b = normalizePlayerIdentity(right).split(' ');
  if (a.length < 2 || b.length < 2) return false;
  // Whole name tokens only. Never use substring/edit-distance or a surname alone.
  if (a.length === b.length && a.slice(1).join(' ') === b.slice(1).join(' ')
    && ((a[0].length === 1 && a[0] === b[0][0]) || (b[0].length === 1 && b[0] === a[0][0]))) return true;
  const [short, long] = a.length <= b.length ? [a,b] : [b,a];
  return new Set(short).size >= 2 && short.every(token => long.includes(token));
}

/** Official league/FPL IDs must never be interpreted as provider IDs. DOB allows
 * transfers between clubs; without DOB, require both exact spelling and club. */
function identityIndex(players, teams, names) {
  const bsd = players.filter(player => player.provider === 'bsd');
  const byName = new Map(names.map(name => [name.player_id, name]));
  const byTeam = new Map(teams.map(team => [team.id, team]));
  const bySpelling=new Map(), byBirthday=new Map();
  for(const player of bsd) {
    for(const key of new Set(variants(player).map(compact).filter(Boolean))) {
      const group=bySpelling.get(key)??[];group.push(player);bySpelling.set(key,group);
    }
    if(player.birth_date) { const group=byBirthday.get(player.birth_date)??[];group.push(player);byBirthday.set(player.birth_date,group); }
  }
  return {bsd,byName,byTeam,bySpelling,byBirthday};
}

export function matchWorkbookPlayer(row, players, teams, names = [], override, index = identityIndex(players,teams,names)) {
  const {bsd,byName,byTeam,bySpelling,byBirthday}=index;
  const sameTeam = player => {
    const team = byTeam.get(player.team_id);
    return team && [team.name, team.english].some(name => teamKey(name) === teamKey(row.team));
  };
  const exact = player => variants(player).some(name => equalName(row.name, name));
  const compatibleDate = player => !row.birth_date || !player.birth_date || sameDay(row.birth_date, player.birth_date);
  if (override) {
    const player = bsd.find(player => player.id === override.id);
    if (!player || player.name !== override.expected_name || !sameDay(player.birth_date, override.birth_date)
      || !sameDay(row.birth_date, override.birth_date)) return { reason: 'reviewed_identity_changed', candidates: [] };
    return { player, method: 'reviewed_identity' };
  }
  const exactPlayers=bySpelling.get(compact(row.name))??[], birthdayPlayers=byBirthday.get(row.birth_date)??[];
  const tiers = [
    ['exact_name_and_birth_date', exactPlayers.filter(player => sameDay(row.birth_date, player.birth_date))],
    ['exact_name_and_team', exactPlayers.filter(player => compatibleDate(player) && sameTeam(player))],
    ['full_name_and_birth_date', birthdayPlayers.filter(player => variants(player).some(name => compatibleFullName(row.name, name)))],
    ['existing_korean_and_birth_date', birthdayPlayers.filter(player => row.name_ko && [player.name_ko, byName.get(player.id)?.display_name].includes(row.name_ko))],
  ];
  for (const [method, candidates] of tiers) {
    if (candidates.length === 1) return { player: candidates[0], method };
    if (candidates.length > 1) return { reason: 'ambiguous_identity', candidates: candidates.map(player => player.id) };
  }
  const candidates = [...new Map([...exactPlayers,...birthdayPlayers].map(player=>[player.id,player])).values()];
  return { reason: candidates.some(player => exact(player) && !compatibleDate(player)) ? 'birth_date_conflict' : 'no_verified_identity',
    candidates: candidates.map(({ id,name,birth_date,team_id }) => ({ id,name,birth_date,team_id })).slice(0,8) };
}

export function planWorkbookNames(data, players, teams, names) {
  validateWorkbookNames(data);
  const existing = new Map(names.map(name => [name.player_id, name]));
  const overrides = new Map((data.identity_overrides ?? []).map(row => [row.key,row]));
  const index=identityIndex(players,teams,names);
  const rows = [], skipped = [], counts = {};
  for (const row of data.players) {
    const league = row.key.split(':')[0];
    counts[league] ??= { total:0, supplied:0, blank:0, matched:0, changed:0, confirmed:0, preserved:0, unresolved:0 };
    const count = counts[league]; count.total++;
    if (!row.name_ko) { count.blank++; skipped.push({ key:row.key, name:row.name, reason:'blank_keeps_existing' }); continue; }
    count.supplied++;
    const match = matchWorkbookPlayer(row, players, teams, names, overrides.get(row.key),index);
    if (!match.player) { count.unresolved++; skipped.push({ key:row.key, name:row.name, birth_date:row.birth_date, team:row.team, ...match }); continue; }
    count.matched++;
    const player = match.player, before = existing.get(player.id);
    const reference = `workbook:${data.version}:${row.key}`;
    // Human edits made before or after this import keep priority. An identical
    // imported label is already protected and requires no further write.
    if (before?.source === 'manual') {
      const reason = before.display_name === row.name_ko ? 'already_confirmed' : 'manual_override_preserved';
      count[reason === 'already_confirmed' ? 'confirmed' : 'preserved']++;
      skipped.push({ key:row.key, id:player.id, name:row.name, reason }); continue;
    }
    const aliases = [...new Set([...(before?.aliases ?? []), before?.display_name, player.name, player.english, row.name, ...row.aliases]
      .filter(value => typeof value === 'string' && value.length > 0 && value.length <= 80 && value !== row.name_ko))].slice(0,20);
    rows.push({ key:row.key, id:player.id, player, before:before ?? null, method:match.method,
      changed:(player.name_ko || before?.display_name) !== row.name_ko,
      value:{ player_id:player.id, display_name:row.name_ko, aliases, source:'manual', source_id:reference } });
  }
  // Duplicate sheet records for one BSD identity may not choose a winner by order.
  const targets = new Map();
  for (const row of rows) { const target=targets.get(row.id)??[]; target.push(row); targets.set(row.id,target); }
  const safe = [];
  for (const group of targets.values()) {
    if (new Set(group.map(row => row.value.display_name)).size > 1) {
      for (const row of group) { const count=counts[row.key.split(':')[0]]; count.matched--; count.unresolved++; skipped.push({key:row.key,id:row.id,reason:'conflicting_workbook_labels'}); }
    } else {
      const row=group[0], count=counts[row.key.split(':')[0]];
      count[row.changed?'changed':'confirmed']++;
      safe.push(row);
      for (const duplicate of group.slice(1)) { counts[duplicate.key.split(':')[0]].confirmed++; skipped.push({key:duplicate.key,id:row.id,reason:'duplicate_identical_label'}); }
    }
  }
  return { version:data.version, counts, rows:safe, skipped };
}

export async function readWorkbookNameState(db) {
  const [players, teams, names] = await Promise.all([
    readAllNames(db,'players','id,name,english,short_name,birth_date,team_id,provider,name_ko'),
    readAllNames(db,'teams','id,name,english'),
    readAllNames(db,'player_names','player_id,display_name,aliases,source,source_id,updated_at'),
  ]);
  return { players,teams,names };
}

const requireData = result => { if (result.error) throw result.error; return result.data ?? []; };

export async function writeWorkbookName(db, row, now = new Date().toISOString()) {
  // Check the provider identity again immediately before writing. Reused IDs,
  // changed birthdays/names or a changed team invalidate the original plan.
  const current = requireData(await db.from('players').select('id,name,english,birth_date,team_id,provider').eq('id',row.id));
  if (current.length !== 1 || ['name','english','birth_date','team_id','provider'].some(key => current[0][key] !== row.player[key])) return { id:row.id, status:'identity_changed' };
  const value={ ...row.value, updated_at:now };
  let written;
  if (row.before) {
    let query=db.from('player_names').update(value).eq('player_id',row.id);
    // Compare-and-swap preserves a concurrent admin edit or automatic name update.
    for (const key of ['display_name','source','source_id','updated_at']) {
      if (!own(row.before,key)) throw new Error('INCOMPLETE_WORKBOOK_NAME_SNAPSHOT');
      query=row.before[key] == null ? query.is(key,null) : query.eq(key,row.before[key]);
    }
    written=requireData(await query.select('player_id'));
  } else {
    written=requireData(await db.from('player_names').upsert(value,{onConflict:'player_id',ignoreDuplicates:true}).select('player_id'));
  }
  return { id:row.id, key:row.key, status:written.length===1?'applied':'concurrent_name_preserved', changed:row.changed,
    before:row.before?.display_name ?? row.player.name_ko ?? null, after:row.value.display_name };
}

export async function applyWorkbookNames(db, data, { apply=false, emit=()=>{} }={}) {
  const before=await readWorkbookNameState(db), plan=planWorkbookNames(data,before.players,before.teams,before.names);
  emit({stage:'workbook-name-plan',version:plan.version,counts:plan.counts,writes:plan.rows.length});
  const results=[], errors=[];
  if (apply) {
    for (let start=0; start<plan.rows.length; start+=80) {
      const batch=plan.rows.slice(start,start+80), written=[];
      for (let offset=0;offset<batch.length;offset+=8) {
        const settled=await Promise.allSettled(batch.slice(offset,offset+8).map(row=>writeWorkbookName(db,row)));
        for (let index=0;index<settled.length;index++) {
          const result=settled[index];
          if (result.status==='fulfilled') { results.push(result.value); if(result.value.status==='applied')written.push(result.value); }
          else errors.push({id:batch[offset+index].id,code:result.reason?.code??'NAME_WRITE_FAILED'});
        }
      }
      if(written.length)requireData(await db.from('operation_audit').insert({actor:null,action:'catalog.workbook_korean_names',
        detail:{version:plan.version,changes:written}}));
      emit({stage:'workbook-name-batch',processed:Math.min(start+80,plan.rows.length),applied:results.filter(row=>row.status==='applied').length,errors:errors.length});
      if(errors.length)break;
    }
  }
  const after=apply?await readWorkbookNameState(db):before;
  const byId=new Map(after.names.map(row=>[row.player_id,row]));
  const players=new Map(after.players.map(row=>[row.id,row]));
  const verification=results.filter(row=>row.status==='applied').filter(row=>{
    const name=byId.get(row.id);return name?.display_name!==row.after||name?.source!=='manual'||players.get(row.id)?.name_ko!==row.after;
  }).map(row=>row.id);
  const report={version:plan.version,mode:apply?'apply':'dry-run',counts:plan.counts,
    planned:plan.rows.length,applied:results.filter(row=>row.status==='applied').length,
    labelsChanged:results.filter(row=>row.status==='applied'&&row.changed).length,
    verified:results.filter(row=>row.status==='applied').length-verification.length,
    failures:errors,verificationFailures:verification,
    results,skipped:plan.skipped,
    resolved:plan.rows.map(row=>({key:row.key,id:row.id,providerName:row.player.name,birth_date:row.player.birth_date,team_id:row.player.team_id,before:row.before?.display_name??row.player.name_ko,after:row.value.display_name,method:row.method})),
  };
  emit({stage:'workbook-name-result',mode:report.mode,applied:report.applied,labelsChanged:report.labelsChanged,verified:report.verified,failures:errors.length,verificationFailures:verification.length});
  return report;
}
