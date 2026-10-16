import { createHash } from 'node:crypto';
import { checked } from './automatic-football.mjs';

const normal = value => (value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const claimValues = (entity, property) => (entity.claims?.[property] ?? []).filter(c => c.rank !== 'deprecated').map(c => c.mainsnak?.datavalue?.value).filter(Boolean);
export function compatibleName(input, candidate) {
  const a = normal(input), b = normal(candidate);
  if (a === b) return true;
  const x = a.split(' '), y = b.split(' ');
  return x.length >= 2 && x[0].length === 1 && x.length === y.length && x[0] === y[0][0] && x.slice(1).join(' ') === y.slice(1).join(' ');
}
/** Accept a unique footballer with an exact day-level DOB and compatible label/alias.
 * A Korean name is a published label/title, never an invented translation. */
export function matchKoreanName(player, entities) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(player.birth_date ?? '')) return null;
  const matches = Object.values(entities).filter(e => {
    if (!claimValues(e, 'P31').some(v => v.id === 'Q5') || !claimValues(e, 'P106').some(v => v.id === 'Q937857')) return false;
    const dates = claimValues(e, 'P569').filter(v => v.precision >= 11).map(v => v.time?.slice(1, 11));
    if (!dates.length || dates.some(d => d !== player.birth_date)) return false;
    const names = [...Object.values(e.labels ?? {}).map(x => x.value), ...Object.values(e.aliases ?? {}).flat().map(x => x.value)];
    return names.some(n => compatibleName(player.name, n) || (player.english && compatibleName(player.english, n)));
  });
  if (matches.length !== 1) return null;
  const e = matches[0], label = e.labels?.ko?.value ?? e.sitelinks?.kowiki?.title?.replace(/\s*\([^)]*\)$/, '');
  if (!label || label.length > 80 || !/[가-힣]/.test(label) || !/^Q\d+$/.test(e.id)) return null;
  const aliases = [...new Set([player.name, player.english, e.labels?.en?.value, ...(e.aliases?.ko ?? []).map(x => x.value)].filter(x => x && x.length <= 80 && x !== label))].slice(0, 20);
  return { displayName: label, aliases, sourceId: e.id };
}
async function wiki(params, fetchImpl, wait) {
  await wait(500);
  const url = new URL('https://www.wikidata.org/w/api.php');
  for (const [k, v] of Object.entries({ format: 'json', maxlag: '5', ...params })) url.searchParams.set(k, v);
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'KICK-X/1.0 (https://github.com/hyun1290/kick-x-test)' }, signal: AbortSignal.timeout(12000), redirect: 'error' });
  if (!response.ok) throw new Error('NAME_PROVIDER_UNAVAILABLE');
  const data = await response.json();
  if (data.error) throw new Error('NAME_PROVIDER_UNAVAILABLE');
  return data;
}
export async function lookupKoreanName(player, { fetchImpl = fetch, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (!player.birth_date) return null;
  const result = await wiki({ action: 'wbsearchentities', search: player.english || player.name, language: 'en', limit: '5', type: 'item' }, fetchImpl, wait);
  const ids = (result.search ?? []).map(x => x.id).filter(x => /^Q\d+$/.test(x));
  if (!ids.length) return null;
  const detail = await wiki({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|aliases|claims|sitelinks', languages: 'en|ko|de|fr|es|pt|it' }, fetchImpl, wait);
  return matchKoreanName(player, detail.entities ?? {});
}
export const nameSignature = p => createHash('sha256').update(JSON.stringify([p.name, p.english ?? null, p.birth_date ?? null])).digest('hex');
export async function mapPlayerNames(db, { limit = 100, lookup = lookupKoreanName, now = new Date().toISOString(), deadline = Date.now() + 4 * 60000 } = {}) {
  let processed = 0, matched = 0, unmatched = 0;
  for (let offset = 0; processed < limit && Date.now() < deadline; offset += 250) {
    const players = checked(await db.from('players').select('id,name,english,birth_date,player_names(source),name_mapping_checks(checked_at,status,input_signature)').eq('provider', 'bsd').order('id').range(offset, offset + 249));
    for (const p of players) {
      if (processed >= limit || Date.now() >= deadline) break;
      const existing = Array.isArray(p.player_names) ? p.player_names[0] : p.player_names;
      if (existing?.source === 'manual') continue;
      const previous = Array.isArray(p.name_mapping_checks) ? p.name_mapping_checks[0] : p.name_mapping_checks;
      const signature = nameSignature(p);
      const retryDays = previous?.status === 'error' ? 1 : 30;
      if (previous?.input_signature === signature && Date.parse(now) - Date.parse(previous.checked_at) < retryDays * 86400000) continue;
      processed++;
      let result;
      try { result = await lookup(p); }
      catch {
        checked(await db.from('name_mapping_checks').upsert({ player_id: p.id, status: 'error', checked_at: now, input_signature: signature }));
        break; // Back off globally instead of hammering an unavailable public service.
      }
      if (result) {
        const applied = checked(await db.rpc('kickx_apply_automatic_name', { p_player: p.id, p_name: result.displayName, p_aliases: result.aliases, p_source: result.sourceId, p_expected: { name: p.name, english: p.english, birth_date: p.birth_date } }));
        if (applied) matched++;
      } else unmatched++;
      checked(await db.from('name_mapping_checks').upsert({ player_id: p.id, status: result ? 'matched' : 'unmatched', source_id: result?.sourceId ?? null, checked_at: now, input_signature: signature }));
    }
    if (players.length < 250) break;
  }
  return { processed, matched, unmatched };
}
