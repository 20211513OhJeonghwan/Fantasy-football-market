'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
export function Pagination({page,total,size,onPage,label}:{page:number;total:number;size:number;onPage:(page:number)=>void;label:string}) {
  const pages=Math.max(1,Math.ceil(total/size));
  if(!total)return null;
  const start=Math.max(1,Math.min(page-2,pages-4));
  const numbers=Array.from({length:Math.min(5,pages)},(_,i)=>start+i);
  return <nav className="panel-foot pagination numbered-pagination" aria-label={`${label} 페이지 선택`}>
    <span className="num">{(page-1)*size+1}–{Math.min(page*size,total)} / {total.toLocaleString()}</span>
    <div><button aria-label={`이전 ${label} 페이지`} disabled={page<=1} onClick={()=>onPage(page-1)}><ChevronLeft size={17}/></button>
      {start>1 && <button aria-label={`${label} 1페이지`} onClick={()=>onPage(1)}>1</button>}
      {start>2 && <span aria-hidden="true">…</span>}
      {numbers.map(n=><button key={n} className={n===page?'active':''} aria-current={n===page?'page':undefined} aria-label={`${label} ${n}페이지`} onClick={()=>onPage(n)}>{n}</button>)}
      {start+numbers.length<pages && <span aria-hidden="true">…</span>}
      {start+numbers.length<=pages && <button aria-label={`${label} ${pages}페이지`} onClick={()=>onPage(pages)}>{pages}</button>}
      <button aria-label={`다음 ${label} 페이지`} disabled={page>=pages} onClick={()=>onPage(page+1)}><ChevronRight size={17}/></button>
    </div>
  </nav>;
}
