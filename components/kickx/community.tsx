"use client";
import {PollEditor,pollDraftError,type PollDraft} from "./community-poll";
import { Select } from "./select";
import { useTeamOptions } from "./options";
import { supportedTeams, canPostToClub } from "@/lib/kickx/support";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, LoaderCircle, Lock, MessageCircle, Paperclip, Pencil, X } from "lucide-react";
import { dateText, money } from "@/lib/kickx/data";
import { clubIdentity } from "@/lib/kickx/club-identity";
import { POST_LIMITS, validatePost, type PostField } from "@/lib/kickx/validation";
import {apiRequest} from "@/lib/kickx/client";
import {usePost} from "./community-detail";
import {CommunityFeed} from "./community-feed";
import {usePostTradeAttachments} from "./post-trades";
import { usePlatform } from "./provider";
import { useCatalogPlayer } from "./catalog";
import { BackLink, ClubCrest, LeagueMark, DataEmpty, MemberNotice, PageHeading, PlayerPortrait } from "./ui";

const HUB = { club: "/community/clubs", player: "/community/players" } as const;
export function CommunityHub({ kind }: { kind: "club" | "player" }) {
  const { data, getTeam } = usePlatform();
  const [target,setTarget]=useState('');
  const teams=supportedTeams(data.session?.profile);
  const clubOptions=useTeamOptions('전체 구단','all','');
  if(kind==='player')return <><PageHeading eyebrow="PLAYER COMMUNITY" title="선수 커뮤니티" description="선수 상세페이지의 커뮤니티 탭에서 이야기를 나눠보세요."/><Link className="button primary" href="/market">선수 시장 <ArrowRight size={16}/></Link></>;
  return <>
    <PageHeading eyebrow="COMMUNITY" title="구단 커뮤니티" description="응원 구단의 경기와 이야기를 나누세요." action={canPostToClub(data.session?.profile,target||undefined) ? <Link className="button primary" href={`/community/write?scope=club${target?`&target=${target}`:''}`}><Pencil size={16}/>글쓰기</Link> : !data.session?.profile?.primaryTeam?<Link className="button secondary" href={data.session?"/mypage#my-profile":"/login"}>{data.session?"본진 구단 선택":"로그인"}</Link>:<span className="fine-print">게시글은 본진 구단에서 작성할 수 있습니다.</span>}/>
    <section className="supported-board-clubs" aria-label="나의 응원 구단">
      <strong>나의 응원 구단</strong>
      <nav aria-label="응원 구단 게시글"><button className={!target?'active':''} onClick={()=>setTarget('')}>전체 구단</button>{teams.map(id=><button key={id} className={target===id?'active':''} onClick={()=>setTarget(id)}><ClubCrest id={id} size="small"/>{getTeam(id)?.name||'구단 정보 없음'}</button>)}</nav>
      <Link href={data.session?'/mypage':'/login'}>{teams.length?`설정 ${teams.length} / 5`:data.session?'응원 구단 설정':'로그인하고 응원 구단 설정'} <ArrowRight size={13}/></Link>
    </section>
    <CommunityFeed key={target||'all'} scope="club" target={target||undefined} title={target?`${getTeam(target)?.name??'구단'} 게시판`:'전체 게시글'} compose={false} filter={<Select label="게시판 구단 선택" value={target} onChange={setTarget} options={clubOptions} className="community-club-filter"/>}/>
  </>;
}
export function CommunityScreen({ scope }: { scope: "club" | "player" }) {
  const params=useParams();
  const {data,getTeam,getLeague,status}=usePlatform();
  const target=String(scope==='club'?params.teamId:params.playerId);
  const detail=useCatalogPlayer(scope==='player'?target:null);
  const team=scope==='club'?getTeam(target):undefined,player=scope==='player'?detail.player:undefined;
  const name=team?.name??player?.name,found=!!name;
  const identity=clubIdentity(team??getTeam(player?.team));
  const league=getLeague(team?.leagueId??getTeam(player?.team)?.leagueId);
  return <>
    <BackLink href={scope==='player'?`/players/${target}`:HUB.club} label={scope==='player'?'선수 상세':'구단 커뮤니티'}/>
    <header className={`lounge-head ${scope}`} style={identity?{'--club':identity.primary,'--club-2':identity.secondary} as CSSProperties:undefined}>
      <div className="lounge-head-mark">{team?<ClubCrest id={team.id} size="large"/>:player?<PlayerPortrait player={player} size="md"/>:<MessageCircle size={28}/>}</div>
      <div className="lounge-head-text"><span className="lounge-head-kicker">{scope==='club'?'구단 게시판':'선수 커뮤니티'}{league&&<LeagueMark league={league} size="sm"/>}</span>
        <h1>{name?`${name} ${scope==='club'?'게시판':'커뮤니티'}`:status==='ready'?'게시판을 찾을 수 없습니다':'게시판'}</h1>
        <p>{team?.english??player?.originalName??player?.english}</p>
      </div>
      {found&&(scope==='player'||canPostToClub(data.session?.profile,target))&&<Link className="button primary" href={`/community/write?scope=${scope}&target=${target}`}><Pencil size={16}/>글쓰기</Link>}
    </header>
    {found?<CommunityFeed scope={scope} target={target} targetName={name} title="게시글" compose={scope==='player'}/>:<DataEmpty entity="게시판" status={scope==='player'?detail.status:status} retry={scope==='player'?detail.reload:undefined}/>}
  </>;
}
export {PostDetail} from "./community-detail";
type DraftState = { scope: "club" | "player"; target: string; title: string; body: string; transaction: string };
const FIELD_ORDER: PostField[] = ["target", "title", "body", "transaction"];
const FIELD_LABEL: Record<PostField, string> = { scope: "게시판 종류", target: "대상", title: "제목", body: "내용", transaction: "거래 첨부" };
function Counter({ value, min, max }: { value: string; min: number; max: number }) {
  const count = [...value.trim()].length;
  const tone = count > max ? "over" : count >= max * 0.9 ? "near" : count > 0 && count < min ? "under" : "";
  return <small className={`char-count num ${tone}`} aria-live="polite">{count.toLocaleString("ko-KR")} / {max.toLocaleString("ko-KR")}</small>;
}
export function WritePost() {
  const sp = useSearchParams();
  const { data } = usePlatform();
  return <PostEditor key={`${sp.toString()}:${data.session?.userId ?? 'guest'}`}/>;
}
function PostEditor() {
  const sp = useSearchParams();
  const { data, status, mock, notify, getTeam, getPlayer, reload } = usePlatform();
  const detail=usePost(sp.get("edit"));
  const existing=detail.data.post?.authorId===data.session?.userId?detail.data.post:undefined;
  const requestId=useRef("");
  const revision=useRef<number|null>(null);
  const [poll,setPoll]=useState<PollDraft|null>(null);
  const [savedId,setSavedId]=useState<string|null>(null);
  const myTeams = supportedTeams(data.session?.profile);
  const myTeam = data.session?.profile?.primaryTeam ?? null;
  const initialScope: DraftState["scope"] = existing?.scope ?? (sp.get("scope") === "player" ? "player" : "club");
  const [draft, setDraft] = useState<DraftState | null>(null);
  const value: DraftState = draft ?? {
    scope: initialScope,
    target: existing?.target ?? sp.get("target") ?? (initialScope === "club" ? myTeam ?? "" : ""),
    title: existing?.title ?? "",
    body: existing?.body ?? "",
    transaction: existing?.transaction?.id ?? "",
  };
  const [touched, setTouched] = useState<Partial<Record<PostField, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<"edit" | "saving" | "done">("edit");
  const [serverNote, setServerNote] = useState("");
  const lock = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const selectedPlayer=useCatalogPlayer(value.scope==="player"?value.target:null);
  const targets = value.scope === "club" ? data.teams : selectedPlayer.player ? [selectedPlayer.player] : [];
  const attachments = usePostTradeAttachments(value.scope,value.target,true);
  const transactions = [...new Map([...attachments.items,...(existing?.transaction ? [existing.transaction] : [])].filter(t=>value.scope==='club'||t.playerId===value.target).map(t=>[t.id,t])).values()];
  const clubTargets = useTeamOptions(null).filter((o) => o.value===myTeam);
  const errors = validatePost(value, {
    myTeam, myTeams, primaryTeam:data.session?.profile?.primaryTeam??null,
    targets: targets.map((t) => t.id),
    transactions: transactions.map(t => t.id),
  });
  const errorFields = FIELD_ORDER.filter((f) => errors[f]);
  const visible = (field: PostField) => (attempted || touched[field]) && errors[field];
  const dirty = (draft !== null || poll !== null) && phase === "edit";
  const isEdit = sp.has("edit");
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const reset = () => { setDraft(null); setTouched({}); setAttempted(false); setServerNote("");setPoll(null); requestId.current=""; revision.current=null; };
  const update = (patch: Partial<DraftState>) => { revision.current ??= existing?.revision??0;requestId.current="";setDraft({ ...value, ...patch }); setServerNote(""); };
  const blur = (field: PostField) => () => setTouched((t) => ({ ...t, [field]: true }));
  const fieldProps = (field: PostField) => ({
    id: `post-${field}`,
    "aria-invalid": !!visible(field),
    "aria-describedby": `post-${field}-hint${visible(field) ? ` post-${field}-error` : ""}`,
    onBlur: blur(field),
    disabled: phase !== "edit",
  });
  const fieldError = (field: PostField) => visible(field) ? <p className="field-error" id={`post-${field}-error`}>{errors[field]}</p> : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (errorFields.length) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    const pollError=pollDraftError(poll);if(pollError){setServerNote(pollError);return;}
    if (lock.current) return;
    lock.current = true;setPhase("saving");requestId.current ||= crypto.randomUUID();
    try{
      if(mock){setPhase("done");notify("게시글 등록 예시입니다. 실제로 저장되지 않습니다.");}
      else{const result=await apiRequest<{id:string}>("/api/kickx/community","POST",{...value,poll:!isEdit?poll:undefined,action:isEdit?"editPost":"createPost",postId:existing?.id,revision:revision.current??existing?.revision,requestId:requestId.current});setSavedId(result.id);setPhase("done");reload();notify("게시글을 저장했습니다.");}
    }catch(e){setServerNote(e instanceof Error?e.message:"저장하지 못했습니다.");setPhase("edit");}finally{lock.current=false;}
  }
  const hub = value.scope==='player' && value.target ? `/players/${value.target}` : HUB.club;
  const targetName = value.scope === "club" ? getTeam(value.target)?.name : selectedPlayer.player?.name;
  const attached = transactions.find((t) => t.id === value.transaction);
  if(isEdit&&!existing)return <DataEmpty entity="수정할 게시글" status={detail.status}/>;
  if (phase === "done")
    return (
      <div className="reading-width">
        <section className="panel frame write-done">
          <span className="trade-done-mark"><Pencil size={28} /></span>
          <h1>게시글을 {isEdit ? "수정" : "등록"}했습니다</h1>
          <p>{mock ? "예시 모드에서는 게시글이 실제로 저장되지 않습니다." : "라운지에서 게시글을 확인할 수 있습니다."}</p>
          <div className="button-row">
            {savedId&&<Link className="button primary" href={`/community/posts/${savedId}`}>저장한 게시글 보기</Link>}
            <Link className="button secondary" href={hub}>{value.scope === "club" ? "구단 커뮤니티" : "선수 커뮤니티"}</Link>
            {value.target && <Link className="button primary" href={`${HUB[value.scope]}/${value.target}`}>{targetName ? `${targetName} 라운지` : "라운지"}로 이동 <ArrowRight size={16} /></Link>}
          </div>
        </section>
      </div>
    );
  return (
    <div className="reading-width">
      <BackLink href={hub} label={value.scope === "club" ? "구단 커뮤니티" : "선수 커뮤니티"} />
      <PageHeading eyebrow="SHARE YOUR PERSPECTIVE" title={isEdit ? "게시글 수정" : "새 게시글"} description="경기를 본 시선, 선수에 대한 생각, 나의 거래 판단을 나눠보세요." />
      <MemberNotice />
      <form onSubmit={submit} noValidate className="panel frame write-form" aria-busy={phase === "saving"}>
        {attempted && errorFields.length > 0 && (
          <div className="error-summary" ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby="error-summary-title">
            <strong id="error-summary-title">입력 내용을 확인해 주세요 · {errorFields.length}건</strong>
            <ul>
              {errorFields.map((f) => (
                <li key={f}><a href={`#post-${f}`} onClick={(e) => { e.preventDefault(); document.getElementById(`post-${f}`)?.focus(); }}><b>{FIELD_LABEL[f]}</b> {errors[f]}</a></li>
              ))}
            </ul>
          </div>
        )}
        <div className="form-grid">
          <div className={`field ${visible("target") ? "invalid" : ""}`}>
            {value.scope === "club" ? <>
              <label htmlFor="post-target">대상 구단 <span className="req" aria-hidden="true">*</span></label>
              <Select id="post-target" invalid={!!visible("target")} describedBy="post-target-hint" onBlur={blur("target")}
                disabled={isEdit || phase !== "edit" || !myTeam} value={value.target} onChange={target => update({ target, transaction: "" })} placeholder="구단 선택" options={clubTargets}/>
              <small id="post-target-hint">본진 구단에만 게시글을 작성할 수 있습니다. {!myTeam&&<Link className="text-link" href="/mypage#my-profile">본진 구단 설정 →</Link>}</small>
            </> : <div id="post-target" className={`post-fixed-target${value.target ? "" : " missing"}`} tabIndex={-1}>{(() => { const target = getPlayer(value.target); return target ? <PlayerPortrait player={target} size="sm" /> : <span className="post-fixed-icon" aria-hidden="true"><MessageCircle size={18} /></span>; })()}<span className="post-fixed-text"><small>게시 대상</small><strong>{targetName ? `${targetName} 커뮤니티` : "선수 상세페이지에서 글쓰기를 시작해 주세요."}</strong>{value.target ? <small>이 선수에 대한 게시글을 작성합니다.</small> : <Link className="text-link" href="/market">선수 시장으로 이동 →</Link>}</span>{value.target && <span className="post-fixed-lock"><Lock size={12} />고정</span>}</div>}
            {fieldError("target")}
          </div>
        </div>
        <div className={`field ${visible("title") ? "invalid" : ""}`}>
          <div className="label-row"><label htmlFor="post-title">제목 <span className="req" aria-hidden="true">*</span></label><Counter value={value.title} min={POST_LIMITS.titleMin} max={POST_LIMITS.titleMax} /></div>
          <input {...fieldProps("title")} required minLength={POST_LIMITS.titleMin} maxLength={POST_LIMITS.titleMax} value={value.title} onChange={(e) => update({ title: e.target.value })} placeholder="제목을 입력하세요" />
          <small id="post-title-hint">필수 입력 · {POST_LIMITS.titleMin}–{POST_LIMITS.titleMax}자</small>
          {fieldError("title")}
        </div>
        <div className={`field ${visible("body") ? "invalid" : ""}`}>
          <div className="label-row"><label htmlFor="post-body">내용 <span className="req" aria-hidden="true">*</span></label><Counter value={value.body} min={POST_LIMITS.bodyMin} max={POST_LIMITS.bodyMax} /></div>
          <textarea {...fieldProps("body")} value={value.body} onChange={(e) => update({ body: e.target.value })} rows={11} placeholder="경기에 대한 생각과 선수에 대한 이야기를 나눠보세요" />
          <small id="post-body-hint">{POST_LIMITS.bodyMin}자 이상 · 근거 있는 의견과 서로에 대한 존중을 부탁드립니다.</small>
          {fieldError("body")}
        </div>
        <div className={`field attachment ${visible("transaction") ? "invalid" : ""}`}>
          <div className="label-row"><label htmlFor="post-transaction"><Paperclip size={15} /> 내 거래 내역 첨부</label><small>선택</small></div>
          <Select id="post-transaction" invalid={!!visible("transaction")} describedBy={`post-transaction-hint${visible("transaction") ? " post-transaction-error" : ""}`} onBlur={blur("transaction")}
            disabled={phase !== "edit" || !transactions.length} value={value.transaction} onChange={(transaction) => update({ transaction })} placeholder="첨부하지 않음"
            options={[{ value: "", label: "첨부하지 않음" }, ...(transactions.map((t) => ({ value: t.id, label: `${t.playerName} · ${t.type === "buy" ? "매입" : "매각"}`, hint: `${money(t.price)} P · ${dateText(t.date, false)}` })) ?? [])]} />
          <small id="post-transaction-hint">{transactions.length ? (value.scope === "player" ? "이 선수의 본인 거래만 첨부할 수 있으며 함께 공개됩니다." : "본인의 거래만 첨부할 수 있으며 함께 공개됩니다.") : "첨부할 수 있는 거래 내역이 없습니다."}</small>
          {attachments.loading&&<small role="status">거래 내역을 확인하고 있습니다…</small>}
          {attachments.error&&<button type="button" className="text-link" onClick={attachments.reload}>거래 내역 다시 불러오기</button>}
          {attachments.hasMore&&<button type="button" className="text-link" onClick={attachments.loadMore}>이전 거래 더 불러오기</button>}
          {fieldError("transaction")}
          {attached && (
            <div className="attached-trade compact">
              <span className="attached-label"><Paperclip size={14} />첨부 미리보기</span>
              <div className="attached-row">
                <span className={`trade-type ${attached.type}`}>{attached.type === "buy" ? "매입" : "매각"}</span>
                <strong>{attached.playerName}</strong>
                <span className="num">{money(attached.price)} P</span>
                <span className="muted">{dateText(attached.date)}</span>
                <button type="button" className="attachment-remove" aria-label="거래 첨부 취소" disabled={phase !== "edit"} onClick={() => update({ transaction: "" })}><X size={14}/>첨부 취소</button>
              </div>
            </div>
          )}
        </div>
        {!isEdit?<PollEditor value={poll} onChange={value=>{requestId.current="";setPoll(value);}} disabled={phase!=="edit"}/>:existing?.poll?<p className="fine-print">이 게시글의 투표는 질문·선택지를 변경할 수 없습니다.</p>:null}
        {serverNote && (
          <div className="data-notice" role="alert">
            <Lock size={15} />
            <span>{serverNote}{/다른 창/.test(serverNote) && " 작성 중인 내용은 그대로 남아 있습니다. 필요한 부분을 복사한 뒤 최신 글을 확인해 주세요."}</span>
            {/다른 창/.test(serverNote) && existing && <Link className="text-link" href={`/community/posts/${existing.id}`} target="_blank">최신 글 새 창에서 보기</Link>}
          </div>
        )}
        <div className="form-actions">
          <p className="fine-print">{mock ? "예시 모드 · 등록해도 실제로 저장되지 않습니다." : status === "ready" && !data.session ? "로그인 후 작성할 수 있습니다." : "저장한 글은 해당 라운지에 공개됩니다."}</p>
          <Link className="button secondary" href={hub} onClick={reset}>취소</Link>
          <button type="submit" className="button primary" disabled={phase !== "edit" || !data.session || !value.target} aria-busy={phase === "saving"}>
            {phase === "saving" ? <><LoaderCircle size={16} className="kx-spin" />등록 중…</> : <><Pencil size={16} />{isEdit ? "수정 저장" : "게시글 등록"}</>}
          </button>
        </div>
      </form>
    </div>
  );
}
