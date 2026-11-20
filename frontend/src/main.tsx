import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {activeSegment, formatTime, type Segment} from './sync';
import {demoVideo} from './demo';
import {translationLanguageName} from './language';
import './style.css';

type Video = typeof demoVideo;
type Summary = Omit<Video,'segments'>;
const states:Record<string,string> = {queued:'Queued',extracting:'Extracting audio',transcribing:'Transcribing Mandarin',ready:'Ready to study',error:'Processing failed',translation_error:'Translation incomplete',interrupted:'Processing interrupted'};
const busy = (s:string)=>['queued','extracting','transcribing','translating'].includes(s);
async function api<T>(url:string, init?:RequestInit):Promise<T> {
  const r = await fetch(url,init);
  if(!r.ok) { let message = 'Cannot reach the backend.'; try { const data = await r.json(); message = typeof data.detail==='string'?data.detail:'Invalid data. Please check your input.'; } catch {} throw new Error(message); }
  return r.json();
}
function App() {
  const [video,setVideo] = useState<Video>(demoVideo);
  const [library,setLibrary] = useState<Summary[]>([]);
  const [online,setOnline] = useState(false);
  const [error,setError] = useState('');
  const [upload,setUpload] = useState<number|null>(null);
  const [follow,setFollow] = useState(true);
  const [active,setActive] = useState<number|null>(null);
  const [editing,setEditing] = useState<Segment|null>(null);
  const [saving,setSaving] = useState(false);
  const [limits,setLimits] = useState({max_upload_mb:500,max_duration_seconds:3600});
  const player = useRef<HTMLVideoElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const replayEnd = useRef<number|null>(null);
  const chosen = useRef('demo');
  const uploader = useRef<XMLHttpRequest|null>(null);
  const languageName = translationLanguageName(video.translation_language);
  const statusText = video.status==='translating' ? `Translating into ${languageName}` : states[video.status]??video.status;
  async function refresh() {
    try {setLibrary(await api<Summary[]>('/api/videos'));setOnline(true);} catch {setOnline(false);}
  }
  useEffect(()=>{void refresh(); void api<typeof limits>('/api/config').then(setLimits).catch(()=>{}); return ()=>uploader.current?.abort();},[]);
  useEffect(()=>{
    if(video.id==='demo') return;
    let cancelled=false;
    const id=video.id;
    const timer=setInterval(async()=>{try {
      const next=await api<Video>(`/api/videos/${id}`);
      if(!cancelled) {setVideo(next);setOnline(true);void refresh();}
    } catch {if(!cancelled) setOnline(false);}},2000);
    return ()=>{cancelled=true;clearInterval(timer);};
  },[video.id]);
  useEffect(()=>{if(follow && active!==null) list.current?.querySelector(`[data-segment="${active}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'});},[active,follow]);
  useEffect(()=>{
    const v=player.current;
    let frame:number;
    function tick() {
      if(v) {
        if(replayEnd.current!==null && v.currentTime*1000>=replayEnd.current) {
          v.pause();v.currentTime=replayEnd.current/1000;replayEnd.current=null;
        }
        setActive(activeSegment(video.segments,v.currentTime*1000));
      }
      frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);return ()=>cancelAnimationFrame(frame);
  },[video.segments]);
  async function open(id:string) {
    chosen.current=id;setError('');setEditing(null);replayEnd.current=null;setActive(null);
    if(id==='demo') {setVideo(demoVideo);return;}
    try {const next=await api<Video>(`/api/videos/${id}`);if(chosen.current===id) setVideo(next);} catch(e) {setError((e as Error).message);}
  }
  function play(s:Segment, replay=false) {
    const v=player.current;if(!v) return;
    replayEnd.current=replay?s.end_ms:null;v.currentTime=s.start_ms/1000;
    void v.play().catch((e:DOMException)=>{if(e.name!=='AbortError')setError('Playback failed. Check that your browser supports the video codec.');});
  }
  async function retry(translation:boolean) {
    setError('');try {await api(`/api/videos/${video.id}/retry?translation_only=${translation}`,{method:'POST'});setVideo(v=>({...v,status:'queued',error:''}));}catch(e){setError((e as Error).message);}
  }
  function send(file?:File) {
    if(!file) return;
    if(!file.name.toLowerCase().endsWith('.mp4') || file.size>limits.max_upload_mb*1024*1024) {setError(`Choose an MP4 up to ${limits.max_upload_mb} MB.`);return;}
    setError('');setUpload(0);
    const xhr=new XMLHttpRequest();uploader.current=xhr;xhr.open('POST','/api/videos');
    xhr.upload.onprogress=e=>{if(e.lengthComputable)setUpload(Math.round(e.loaded/e.total*100));};
    xhr.onload=()=>{setUpload(null);if(xhr.status===201){const id=JSON.parse(xhr.responseText).id;void refresh();void open(id);}else{try{const data=JSON.parse(xhr.responseText);setError(typeof data.detail==='string'?data.detail:'Upload failed. Check your file.');}catch{setError('Upload failed. Make sure the backend is running.');}}};
    xhr.onerror=()=>{setUpload(null);setError('The connection was lost during upload.');};
    const form=new FormData();form.append('file',file);xhr.send(form);
  }
  async function save(e:React.FormEvent) {
    e.preventDefault();if(!editing) return;setSaving(true);
    try {
      if(video.id==='demo') {
        setError('Saved corrections are available for uploaded videos. Demo content is read-only.');setEditing(null);return;
      }
      await api(`/api/videos/${video.id}/segments/${editing.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({hanzi:editing.hanzi,translation_id:editing.translation_id})});
      setVideo(await api<Video>(`/api/videos/${video.id}`));setEditing(null);
    }catch(e){setError((e as Error).message);}finally{setSaving(false);}
  }
  function exportDemo(kind:string) {
    const stamp=(ms:number)=>`00:${formatTime(ms)},000`;
    const text=(kind==='txt'?`Translation language: ${languageName} (${video.translation_language})\n\n`:'')+video.segments.map((s,i)=>kind==='txt'?`${s.hanzi}\n${s.units.map(u=>u.pinyin||u.hanzi).join(' ')}\n${s.translation_id}`:`${i+1}\n${stamp(s.start_ms)} --> ${stamp(s.end_ms)}\n${kind==='srt-hanzi'?s.hanzi:s.translation_id}`).join('\n\n');
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`hanzireel-demo.${kind==='srt-hanzi'?'zh':video.translation_language}.${kind==='txt'?'txt':'srt'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <>
    <header><a className="brand" href="/">汉 <span>HanziReel</span></a><span className="local">Learn Mandarin · locally</span></header>
    <main>
      <section className="library" aria-label="Video library">
        <label>Your videos<select value={video.id} onChange={e=>void open(e.target.value)}><option value="demo">Demo — Today’s plans</option>{library.map(v=><option key={v.id} value={v.id}>{v.name} · {translationLanguageName(v.translation_language)}</option>)}</select></label>
        <label className={`upload-button ${upload!==null?'disabled':''}`}>{upload===null?'＋ Upload MP4':upload===100?'Validating media…':`Uploading ${upload}%`}<input type="file" accept="video/mp4,.mp4" disabled={upload!==null} onChange={e=>{send(e.target.files?.[0]);e.target.value='';}}/></label>
      </section>
      {!online && <p className="notice">Demo mode is available. To upload and save videos, start the backend on port 8000.</p>}
      {error && <div className="error" role="alert">{error}<button aria-label="Dismiss message" onClick={()=>setError('')}>×</button></div>}
      <div className="workspace">
        <section className="watch" aria-label="Video player">
          <h1>{video.name}</h1>
          {video.demo===1 && <p className="demo-label">Demo mode · original animation and tones, without speech. The transcript is sample content.</p>}
          <video key={video.id} ref={player} controls preload="metadata" src={video.id==='demo'?'/demo.mp4':`/api/videos/${video.id}/media`} onSeeking={()=>{const v=player.current;if(v && replayEnd.current!==null && v.currentTime*1000>replayEnd.current) replayEnd.current=null;}} onError={()=>setError('Cannot load the video. Check the backend or MP4 codec (H.264/AAC recommended).')} />
          <div className="video-meta"><span>{formatTime(video.duration*1000)} · {video.demo?'Demo':'MP4'}</span><span role="status">{statusText}</span></div>
          {busy(video.status) && <div className="processing"><progress aria-label={statusText}/><p>{statusText}. You can read the transcript as soon as it is available.</p></div>}
          {video.error && <p className="error" role="status">{video.error}</p>}
          <div className="actions">
            {!video.demo && !busy(video.status) && <><button onClick={()=>void retry(true)} disabled={!video.segments.length}>Retry translation</button>{['error','interrupted'].includes(video.status) && <button onClick={()=>void retry(false)}>Retry processing</button>}</>}
          </div>
          <details><summary>How to study</summary><p>Click a line to play from its start. The ↻ button plays one segment, then stops. Use Tab and Enter for keyboard navigation.</p><p>Upload a Mandarin MP4 up to {limits.max_upload_mb} MB / {Math.floor(limits.max_duration_seconds/60)} minutes. Videos and corrections are saved on this computer. New videos are translated into English.</p></details>
        </section>
        <section className="transcript" aria-label="Interactive transcript">
          <div className="transcript-head"><h2>Transcript <span>{video.segments.length} segments</span></h2><label className="check"><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/>Follow dialogue</label></div>
          <div className="column-labels"><span>Mandarin & pinyin</span><span>{languageName} translation</span></div>
          {video.translation_language==='id' && <p className="notice">This video uses Indonesian translations from an earlier release. Retries keep Indonesian.</p>}
          <div className="segments" ref={list}>
            {!video.segments.length && <p className="empty">The transcript will appear after speech recognition finishes.</p>}
            {video.segments.map(s=><article data-segment={s.id} key={s.id} className={`segment ${active===s.id?'active':''}`} aria-current={active===s.id?'true':undefined}>
              <button className="dialog" onClick={()=>play(s)} aria-label={`Play from ${formatTime(s.start_ms)}: ${s.hanzi}`}><span className="time">{formatTime(s.start_ms)} – {formatTime(s.end_ms)}</span><span className="dialog-columns"><span className="hanzi" lang="zh">{s.units.map((u,i)=><ruby key={i}>{u.hanzi}<rt>{u.pinyin||' '}</rt></ruby>)}</span><span className="translation" lang={video.translation_language}>{s.translation_id||'Waiting for translation…'}{['stale','failed'].includes(s.translation_state)&&<em lang="en">{s.translation_state==='stale'?'Needs updating':'Not yet translated'}</em>}</span></span></button>
              <div className="row-actions"><button onClick={()=>play(s,true)} aria-label={`Replay segment ${formatTime(s.start_ms)}`}>↻ <span>Replay</span></button><button disabled={!!video.demo} onClick={()=>setEditing({...s})} aria-label={`Edit segment ${formatTime(s.start_ms)}`}>Edit</button></div>
            </article>)}
          </div>
          <div className="export"><label>Export<select defaultValue="" onChange={e=>{const kind=e.target.value;if(!kind)return;if(video.demo)exportDemo(kind);else window.location.href=`/api/videos/${video.id}/export?kind=${kind}`;e.target.value='';}}><option value="" disabled>Choose a format…</option><option value="txt">TXT · Hanzi, pinyin & {languageName}</option><option value="srt-hanzi">SRT · Hanzi</option><option value="srt-translation">SRT · {languageName}</option></select></label></div>
        </section>
      </div>
    </main>
    {editing && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title" onKeyDown={e=>{if(e.key==='Escape')setEditing(null);if(e.key==='Tab'){const elements=e.currentTarget.querySelectorAll<HTMLElement>('textarea,button');const first=elements[0],last=elements[elements.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}><h2 id="edit-title">Edit segment</h2><form onSubmit={e=>void save(e)}><label>Hanzi<textarea lang="zh" autoFocus required maxLength={5000} value={editing.hanzi} onChange={e=>setEditing({...editing,hanzi:e.target.value})}/></label><label>{languageName} translation<textarea lang={video.translation_language} maxLength={10000} value={editing.translation_id} onChange={e=>setEditing({...editing,translation_id:e.target.value})}/></label><p>Pinyin updates automatically. Segment timestamps stay unchanged.</p><div className="actions"><button type="button" onClick={()=>setEditing(null)}>Cancel</button><button className="primary" disabled={saving}>{saving?'Saving…':'Save corrections'}</button></div></form></section></div>}
  </>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
