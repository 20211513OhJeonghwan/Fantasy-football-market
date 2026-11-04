import { authenticatedClient, failure, HttpError, json } from '@/server/kickx/http';
import { checkDatabase } from '@/server/kickx/prototype';
import { createRequestClient } from '@/server/kickx/supabase';
import { getSupabaseConfig } from '@/server/kickx/config';
import { emptyActivity, parseActivityQuery } from '@/lib/kickx/community-activity';

export async function GET(request: Request) { try {
  let input: ReturnType<typeof parseActivityQuery>;
  try { input = parseActivityQuery(new URL(request.url).searchParams); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : '조회 조건을 확인해 주세요.'); }
  if (!getSupabaseConfig()) return json({ status: 'not-configured', data: emptyActivity() });
  const client = input.author ? await createRequestClient() : (await authenticatedClient()).client;
  const { data, error } = await client.rpc('kickx_community_activity', { p_author: input.author, p_kind: input.kind, p_page: input.page, p_size: 20 });
  checkDatabase(error);
  return json({ status: 'ready', data });
} catch (error) { return failure(error); } }
