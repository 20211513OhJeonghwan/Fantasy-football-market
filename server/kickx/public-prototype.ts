import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {PublicData, Formation} from '@/lib/kickx/types';
import {FORMATIONS, checkDatabase, migrationMissing} from './prototype';
export async function readPrototypePublic(db:SupabaseClient):Promise<Partial<PublicData>> {
 const policy=await db.from('kickx_policy').select('*').single();
 if(migrationMissing(policy.error))return {};checkDatabase(policy.error);
 const [posts,weekly,monthly,counts,market]=await Promise.all([
  db.rpc('kickx_posts',{p_size:20}),
  db.from('ranking_snapshots').select('*').eq('period','weekly').gt('ends_at',new Date().toISOString()).order('calculated_at',{ascending:false}).limit(1),
  db.from('ranking_snapshots').select('*').eq('period','monthly').gt('ends_at',new Date().toISOString()).order('calculated_at',{ascending:false}).limit(1),
  db.rpc('kickx_community_counts'),
  db.rpc('kickx_market_summary'),
 ]);
 for(const r of [posts,weekly,monthly,counts,market])checkDatabase(r.error);
 const freshness=await db.rpc('kickx_data_freshness');
 if(!migrationMissing(freshness.error))checkDatabase(freshness.error);
 const p=policy.data;
 return {freshness:freshness.error?null:freshness.data,market:market.data,communityCounts:counts.data,policy:{version:p.version,initialPoints:p.initial_points,initialPrice:p.initial_price,sellFeeBps:p.sell_fee_bps,quoteSeconds:p.quote_seconds,clubCompetitionsEnabled:p.club_competitions_enabled===true},formations:FORMATIONS as Formation[],posts:posts.data.items,
 rankings:[...(weekly.data??[]),...(monthly.data??[])].map(r=>({id:r.period,startsAt:r.starts_at,endsAt:r.ends_at,calculatedAt:r.calculated_at,rows:r.rows}))};
}
