import { authenticatedClient, failure, HttpError, json, readJson, requireOrigin } from "@/server/kickx/http";
import { asObject, checkDatabase, identity, CATEGORIES, migrationMissing } from "@/server/kickx/prototype";
import { createRequestClient } from "@/server/kickx/supabase";
import { getSupabaseConfig } from "@/server/kickx/config";
import { validatePost } from "@/lib/kickx/validation";
import { parseCommunityQuery, postTitle } from "@/lib/kickx/community";
export async function GET(request:Request){try{
 const p=new URL(request.url).searchParams;const postId=p.get("postId");
 const unavailable={status:"not-configured",data:postId?{post:null,comments:[]}:{items:[],total:0,page:1,size:20}};
 if(!getSupabaseConfig())return json(unavailable);
 const client=await createRequestClient();
 let input: ReturnType<typeof parseCommunityQuery>;
 try { input=parseCommunityQuery(p,CATEGORIES); } catch(e) { throw new HttpError(400,e instanceof Error?e.message:"검색 조건을 확인해 주세요."); }
 const query=postId?client.rpc("kickx_post_detail",{p_id:identity(postId,true),p_page:input.page}):client.rpc("kickx_posts",{p_scope:input.scope,p_target:input.target,p_query:input.query,p_category:input.category,p_sort:input.sort,p_page:input.page,p_size:20});
 const {data,error}=await query;if(migrationMissing(error))return json(unavailable);checkDatabase(error);return json({status:"ready",data});
}catch(error){return failure(error);}}
export async function POST(request:Request){try{
 requireOrigin(request);const {client,user}=await authenticatedClient();const input=asObject(await readJson(request));const action=input.action;
 if(typeof action!=="string")throw new HttpError(400,"요청을 확인해 주세요.");
 if(action==="createPost"||action==="editPost"){
  for(const field of ["scope","target","title","body","category","transaction"])if(typeof input[field]!=="string")throw new HttpError(400,"글 내용을 확인해 주세요.");
  input.title=postTitle(String(input.title),String(input.body));
  if(action==="editPost"){
   const current=await client.rpc("kickx_post_detail",{p_id:identity(input.postId,true),p_page:1});checkDatabase(current.error);
   if(!current.data?.post)throw new HttpError(404,"게시글을 찾을 수 없습니다.");
   if(current.data.post.scope!==input.scope || current.data.post.target!==input.target)throw new HttpError(409,"게시글의 선수·구단 대상을 변경할 수 없습니다.");
  }
  const profile=await client.from("profiles").select("team_id").eq("id",user.id).maybeSingle();checkDatabase(profile.error);
  const target=await client.from(input.scope==="club"?"teams":"players").select("id").eq("id",identity(input.target)).maybeSingle();checkDatabase(target.error);
  const errors=validatePost(input as unknown as Parameters<typeof validatePost>[0],{myTeam:profile.data?.team_id??null,categories:CATEGORIES,targets:target.data?[target.data.id]:[],transactions:input.transaction?[String(input.transaction)]:[]});
  if(Object.keys(errors).length)throw new HttpError(400,Object.values(errors).join(" "));
 }
 const {data,error}=await client.rpc("kickx_community_write",{p_action:action,p_input:input});checkDatabase(error);return json(data);
}catch(error){return failure(error);}}
