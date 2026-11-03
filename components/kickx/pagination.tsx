'use client';
import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type PaginationProps={page:number;total:number;size:number;onPage:(page:number)=>void;label:string;centered?:boolean;allowJump?:boolean};

export function Pagination({page,total,size,onPage,label,centered=false,allowJump=false}:PaginationProps) {
  const [jumpOpen,setJumpOpen]=useState(false);
  const [input,setInput]=useState('');
  const [error,setError]=useState('');
  const field=useRef<HTMLInputElement>(null);
  const trigger=useRef<HTMLButtonElement|null>(null);
  const navigation=useRef<HTMLElement>(null);
  const formId=useId();
  const pages=Math.max(1,Math.ceil(total/size));
  useEffect(()=>{if(jumpOpen){field.current?.focus();field.current?.select();}},[jumpOpen]);
  if(!total)return null;
  const start=Math.max(1,Math.min(page-2,pages-4));
  const numbers=Array.from({length:Math.min(5,pages)},(_,i)=>start+i);
  function selectPage(next:number){setJumpOpen(false);setError('');onPage(next);}
  function closeJump(){setJumpOpen(false);setError('');trigger.current?.focus();}
  function toggleJump(button:HTMLButtonElement){
    trigger.current=button;
    if(jumpOpen){closeJump();return;}
    setInput(String(page));setError('');setJumpOpen(true);
  }
  function submit(event:FormEvent){
    event.preventDefault();
    const value=input.trim(),next=Number(value);
    if(!/^\d+$/.test(value)||!Number.isSafeInteger(next)||next<1||next>pages){
      setError(`1~${pages.toLocaleString()} 사이의 페이지 번호를 입력해 주세요.`);field.current?.focus();return;
    }
    // The old gap button and even this nav can disappear while a remote page loads.
    const target=navigation.current?.closest<HTMLElement>('[data-pagination-focus-target]');
    selectPage(next);
    requestAnimationFrame(()=>{
      if(target?.isConnected)(target.querySelector<HTMLElement>('.numbered-pagination [aria-current="page"]')??target).focus({preventScroll:true});
    });
  }
  function gap(direction:string){
    return allowJump?<button type="button" className="page-jump-toggle" aria-label={`${label} ${direction} 구간 페이지 직접 입력`} aria-expanded={jumpOpen} aria-controls={formId} onClick={event=>toggleJump(event.currentTarget)}>…</button>:<span aria-hidden="true">…</span>;
  }
  return <nav ref={navigation} className={`panel-foot pagination numbered-pagination${centered?' pagination-centered':''}`} aria-label={`${label} 페이지 선택`}>
    <span className="num">{(page-1)*size+1}–{Math.min(page*size,total)} / {total.toLocaleString()}</span>
    <div className="pagination-pages"><button type="button" aria-label={`이전 ${label} 페이지`} disabled={page<=1} onClick={()=>selectPage(page-1)}><ChevronLeft size={17}/></button>
      {start>1 && <button type="button" aria-label={`${label} 1페이지`} onClick={()=>selectPage(1)}>1</button>}
      {start>2 && gap('이전')}
      {numbers.map(n=><button type="button" key={n} className={n===page?'active':''} aria-current={n===page?'page':undefined} aria-label={`${label} ${n}페이지`} onClick={()=>selectPage(n)}>{n}</button>)}
      {start+numbers.length<pages && gap('다음')}
      {start+numbers.length<=pages && <button type="button" aria-label={`${label} ${pages}페이지`} onClick={()=>selectPage(pages)}>{pages}</button>}
      <button type="button" aria-label={`다음 ${label} 페이지`} disabled={page>=pages} onClick={()=>selectPage(page+1)}><ChevronRight size={17}/></button>
    </div>
    {allowJump&&jumpOpen&&<form id={formId} className="page-jump-form" onSubmit={submit} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeJump();}}}>
      <label htmlFor={`${formId}-input`}>이동할 페이지</label>
      <input id={`${formId}-input`} ref={field} type="text" inputMode="numeric" autoComplete="off" aria-label={`${label} 이동할 페이지`} aria-invalid={!!error} aria-describedby={`${formId}-range${error?` ${formId}-error`:''}`} value={input} onChange={event=>{setInput(event.target.value);setError('');}}/>
      <span id={`${formId}-range`} className="page-jump-range">/ {pages.toLocaleString()} 페이지</span>
      <button type="submit">이동</button><button type="button" onClick={closeJump}>취소</button>
      {error&&<p id={`${formId}-error`} role="alert">{error}</p>}
    </form>}
  </nav>;
}
