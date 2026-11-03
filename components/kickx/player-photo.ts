"use client";
import {useState,type SyntheticEvent}from 'react';

/** Read dimensions from the image already fetched by the browser; never issue a metadata probe. */
export function usePlayerPhoto(url?: string | null) {
  const [failed,setFailed]=useState<string|null>(null);
  const [size,setSize]=useState<{url:string;width:number;height:number}|null>(null);
  const photo=url&&failed!==url?url:null;
  const smallSource=!!photo&&size?.url===photo&&size.width>0&&size.height>0&&Math.max(size.width,size.height)<=200;
  function onLoad(event:SyntheticEvent<HTMLImageElement>){
    if(photo)setSize({url:photo,width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight});
  }
  return {photo,smallSource,sourcePixels:smallSource?Math.min(size!.width,size!.height,150):150,onLoad,onError:()=>setFailed(url??null)};
}
