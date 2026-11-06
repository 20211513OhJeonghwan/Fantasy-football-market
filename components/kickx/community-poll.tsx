"use client";
import {useId,useState} from 'react';
import type {Poll} from '@/lib/kickx/types';
import {apiRequest} from '@/lib/kickx/client';
import {dateText} from '@/lib/kickx/data';
import {usePlatform} from './provider';
export type PollDraft={question:string;options:string[];days:number};
export function PollEditor({value,onChange,disabled=false}:{value:PollDraft|null;onChange:(v:PollDraft|null)=>void;disabled?:boolean}){
 const id=useId();
 return <fieldset className="poll-editor" disabled={disabled}><legend>투표 <small>선택</small></legend>
  {!value?<button type="button" className="button secondary small" onClick={()=>onChange({question:'',options:['',''],days:7})}>투표 추가</button>:<>
   <label htmlFor={`${id}-question`}>투표 질문</label><input id={`${id}-question`} required minLength={2} maxLength={120} value={value.question} onChange={e=>onChange({...value,question:e.target.value})} placeholder="함께 의견을 나눌 질문"/>
   {value.options.map((option,i)=><div className="poll-option-input" key={i}><label className="sr-only" htmlFor={`${id}-${i}`}>선택지 {i+1}</label><input id={`${id}-${i}`} required maxLength={80} value={option} placeholder={`선택지 ${i+1}`} onChange={e=>onChange({...value,options:value.options.map((s,n)=>n===i?e.target.value:s)})}/>{value.options.length>2&&<button type="button" className="text-link" aria-label={`선택지 ${i+1} 삭제`} onClick={()=>onChange({...value,options:value.options.filter((_,n)=>n!==i)})}>삭제</button>}</div>)}
   <div className="poll-editor-actions">{value.options.length<6&&<button type="button" className="text-link" onClick={()=>onChange({...value,options:[...value.options,'']})}>선택지 추가</button>}<label>진행 기간 <select value={value.days} onChange={e=>onChange({...value,days:Number(e.target.value)})}>{[1,3,7,14].map(d=><option key={d} value={d}>{d}일</option>)}</select></label><button type="button" className="text-link" onClick={()=>onChange(null)}>투표 제거</button></div>
   <small>선택지 2~6개 · 한 사람당 한 표 · 종료 전 변경 가능 · 게시 후 질문과 선택지는 변경할 수 없습니다.</small>
  </>}
 </fieldset>;
}
export function pollDraftError(p:PollDraft|null):string|null{
 if(!p)return null;
 if(p.question.trim().length<2||p.question.trim().length>120||p.options.length<2||p.options.length>6||p.options.some(s=>!s.trim()||s.trim().length>80)||new Set(p.options.map(s=>s.trim().normalize('NFC').toLocaleLowerCase())).size!==p.options.length)return '투표 질문과 서로 다른 선택지 2~6개를 입력해 주세요.';
 return null;
}
export function CommunityPoll({poll,postId,canVote,onSaved}:{poll:Poll;postId:string;canVote:boolean;onSaved:()=>void}){
 const {mock,notify}=usePlatform();
 const [choice,setChoice]=useState<number|null>(null),[busy,setBusy]=useState(false);
 const selected=choice??poll.myVote;
 const closed=poll.closed||Date.now()>=Date.parse(poll.endsAt);
 async function vote(){if(selected===null||busy||!canVote||closed)return;if(mock){notify('예시 모드 · 실제로 저장되지 않습니다.');return;}setBusy(true);try{await apiRequest('/api/kickx/community','POST',{action:'vote',postId,option:selected});setChoice(null);onSaved();notify('투표를 반영했습니다.');}catch(e){notify(e instanceof Error?e.message:'투표하지 못했습니다.','error');}finally{setBusy(false);}}
 return <section className="community-poll" aria-label="게시글 투표"><h3>{poll.question}</h3><small>{closed?'투표 종료':`${dateText(poll.endsAt)} 마감`} · {poll.total}명 참여</small>
  <div role="group" aria-label="투표 선택지">{poll.options.map((text,i)=>{const count=poll.counts[i]??0,percent=poll.total?Math.round(count*100/poll.total):0;return <button type="button" key={i} className={`poll-option${selected===i?' selected':''}`} disabled={!canVote||closed||busy} aria-pressed={selected===i} onClick={()=>setChoice(i)}><span className="poll-option-fill" style={{width:`${percent}%`}}/><span>{poll.myVote===i?'✓ ':''}{text}</span><strong>{count}표 · {percent}%</strong></button>;})}</div>
  {!closed&&canVote?<button className="button primary small" disabled={busy||selected===null||selected===poll.myVote} onClick={()=>void vote()}>{busy?'반영 중…':poll.myVote===null?'투표하기':'투표 변경'}</button>:!closed?<p className="fine-print">로그인 후 본진·서브팀 게시판과 모든 선수 게시판에서 투표할 수 있습니다.</p>:null}
 </section>;
}
