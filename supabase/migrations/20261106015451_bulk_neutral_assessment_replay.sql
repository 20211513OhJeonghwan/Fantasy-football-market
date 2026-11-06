-- Expand and aggregate validated scoring facts once, rather than planning a query per row.
begin;
do $patch$declare d text;begin
 d:=pg_get_functiondef('public.kickx_apply_neutral_assessments(jsonb)'::regprocedure);
 if position($old$ with converted as materialized(select player_id,fixture_id,kickx_private.recalibrated_breakdown(breakdown,position) parts
 from public.performance_results where rule_version='report-v3' and status in('ready','provisional') and score is not null)
 update public.performance_results r set breakdown=c.parts,score=(select sum((b->>'points')::numeric)from jsonb_array_elements(c.parts)b),
 input_hash=md5(r.input_hash||':neutral-six-20261106'),calculated_at=clock_timestamp() from converted c where r.player_id=c.player_id and r.fixture_id=c.fixture_id;$old$ in d)=0 then raise exception 'REPLAY_FUNCTION_CHANGED';end if;
 d:=replace(d,$old$ with converted as materialized(select player_id,fixture_id,kickx_private.recalibrated_breakdown(breakdown,position) parts
 from public.performance_results where rule_version='report-v3' and status in('ready','provisional') and score is not null)
 update public.performance_results r set breakdown=c.parts,score=(select sum((b->>'points')::numeric)from jsonb_array_elements(c.parts)b),
 input_hash=md5(r.input_hash||':neutral-six-20261106'),calculated_at=clock_timestamp() from converted c where r.player_id=c.player_id and r.fixture_id=c.fixture_id;$old$,$new$ with metrics as materialized(
 select r.player_id,r.fixture_id,b,ord,b->>'metric' metric,(b->>'value')::numeric v,r.position pos
 from public.performance_results r cross join lateral jsonb_array_elements(r.breakdown)with ordinality x(b,ord)
 where r.rule_version='report-v3' and r.status in('ready','provisional') and r.score is not null and b->>'metric'<>'score_range'),
 points as materialized(select player_id,fixture_id,b,ord,round(case metric
 when 'minutes' then 6
 when 'goals' then v*case pos when 'GK' then 4 when 'DF' then 3 when 'MF' then 2.5 else 2 end
 when 'assists' then v*case pos when 'GK' then 2 else 1.5 end
 when 'yellow_cards' then -.7*v when 'red_cards' then -2.5*v when 'own_goals' then -1.5*v
 when 'shots_on_target' then v*case pos when 'MF' then .2 else .25 end
 when 'key_passes' then v*case pos when 'MF' then .25 else .15 end
 when 'crosses_completed' then v*.1 when 'pass_accuracy' then case when v>=85 then .3 else 0 end
 when 'defensive_actions' then case pos when 'DF' then floor(v/3)*.3 else v*.15 end
 when 'clean_sheet' then v*case pos when 'MF' then .3 when 'FW' then 0 else 1 end
 when 'conceded' then -floor(v/2)*.5 when 'saves' then floor(v/3)*.5 when 'penalty_saves' then v*3 else 0 end,2) as points from metrics),
 grouped as materialized(select player_id,fixture_id,sum(points) total,
 jsonb_agg(b||jsonb_build_object('points',points)||case b->>'metric' when 'minutes' then jsonb_build_object('evidence','verified appearance; neutral starting assessment, not a minutes bonus') when 'defensive_actions' then jsonb_build_object('evidence','won_tackle + interception; verified actions only') else '{}'::jsonb end order by ord)parts
 from points group by player_id,fixture_id),
 converted as(select player_id,fixture_id,greatest(0,least(10,total)) score,parts||case when total not between 0 and 10 then jsonb_build_array(jsonb_build_object('metric','score_range','value',total,'points',greatest(0,least(10,total))-total,'evidence','assessment bounded to 0–10')) else '[]'::jsonb end parts from grouped)
 update public.performance_results r set breakdown=c.parts,score=c.score,input_hash=md5(r.input_hash||':neutral-six-20261106'),calculated_at=clock_timestamp() from converted c where r.player_id=c.player_id and r.fixture_id=c.fixture_id;$new$);execute d;
end $patch$;
notify pgrst,'reload schema';
commit;
