import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {activeSegment, formatTime, type Segment} from './sync';
import {demoVideo} from './demo';
import './style.css';

type Video = typeof demoVideo;
type Summary = Omit<Video,'segments'>;
const states:Record<string,string> = {queued:'Dalam antrean',extracting:'Mengekstrak audio',transcribing:'Mentranskripsi Mandarin',translating:'Menerjemahkan ke Indonesia',ready:'Siap dipelajari',error:'Pemrosesan gagal',translation_error:'Terjemahan belum lengkap',interrupted:'Pemrosesan terputus'};
const busy = (s:string)=>['queued','extracting','transcribing','translating'].includes(s);
async function api<T>(url:string, init?:RequestInit):Promise<T> {
  const r = await fetch(url,init);
  if(!r.ok) { let message = 'Backend tidak dapat dihubungi.'; try { const data = await r.json(); message = typeof data.detail==='string'?data.detail:'Data tidak valid. Periksa isian Anda.'; } catch {} throw new Error(message); }
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
    void v.play().catch((e:DOMException)=>{if(e.name!=='AbortError')setError('Pemutaran gagal. Periksa format codec video di browser.');});
  }
  async function retry(translation:boolean) {
    setError('');try {await api(`/api/videos/${video.id}/retry?translation_only=${translation}`,{method:'POST'});setVideo(v=>({...v,status:'queued',error:''}));}catch(e){setError((e as Error).message);}
  }
  function send(file?:File) {
    if(!file) return;
    if(!file.name.toLowerCase().endsWith('.mp4') || file.size>limits.max_upload_mb*1024*1024) {setError(`Pilih MP4 hingga ${limits.max_upload_mb} MB.`);return;}
    setError('');setUpload(0);
    const xhr=new XMLHttpRequest();uploader.current=xhr;xhr.open('POST','/api/videos');
    xhr.upload.onprogress=e=>{if(e.lengthComputable)setUpload(Math.round(e.loaded/e.total*100));};
    xhr.onload=()=>{setUpload(null);if(xhr.status===201){const id=JSON.parse(xhr.responseText).id;void refresh();void open(id);}else{try{setError(JSON.parse(xhr.responseText).detail);}catch{setError('Unggah gagal. Pastikan backend berjalan.');}}};
    xhr.onerror=()=>{setUpload(null);setError('Koneksi terputus saat mengunggah.');};
    const form=new FormData();form.append('file',file);xhr.send(form);
  }
  async function save(e:React.FormEvent) {
    e.preventDefault();if(!editing) return;setSaving(true);
    try {
      if(video.id==='demo') {
        // Backend supplies phrase-aware pinyin for real videos; demo edits use the same API when available.
        setError('Koreksi tersimpan tersedia untuk video unggahan. Mode demo memakai data contoh tetap.');setEditing(null);return;
      }
      await api(`/api/videos/${video.id}/segments/${editing.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({hanzi:editing.hanzi,translation_id:editing.translation_id})});
      setVideo(await api<Video>(`/api/videos/${video.id}`));setEditing(null);
    }catch(e){setError((e as Error).message);}finally{setSaving(false);}
  }
  function exportDemo(kind:string) {
    const stamp=(ms:number)=>`00:${formatTime(ms)},000`;
    const text=video.segments.map((s,i)=>kind==='txt'?`${s.hanzi}\n${s.units.map(u=>u.pinyin||u.hanzi).join(' ')}\n${s.translation_id}`:`${i+1}\n${stamp(s.start_ms)} --> ${stamp(s.end_ms)}\n${kind==='srt-hanzi'?s.hanzi:s.translation_id}`).join('\n\n');
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`hanzireel-demo.${kind==='txt'?'txt':'srt'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <>
    <header><a className="brand" href="/">汉 <span>HanziReel</span></a><span className="local">Belajar Mandarin · lokal</span></header>
    <main>
      <section className="library" aria-label="Pustaka video">
        <label>Video Anda<select value={video.id} onChange={e=>void open(e.target.value)}><option value="demo">Demo — Rencana hari ini</option>{library.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label className={`upload-button ${upload!==null?'disabled':''}`}>{upload===null?'＋ Unggah MP4':upload===100?'Memvalidasi media…':`Mengunggah ${upload}%`}<input type="file" accept="video/mp4,.mp4" disabled={upload!==null} onChange={e=>{send(e.target.files?.[0]);e.target.value='';}}/></label>
      </section>
      {!online && <p className="notice">Mode demo tersedia. Untuk mengunggah dan menyimpan video, jalankan backend di port 8000.</p>}
      {error && <div className="error" role="alert">{error}<button aria-label="Tutup pesan" onClick={()=>setError('')}>×</button></div>}
      <div className="workspace">
        <section className="watch" aria-label="Pemutar video">
          <h1>{video.name}</h1>
          {video.demo===1 && <p className="demo-label">Mode demo · klip grafis buatan sendiri, nada penanda tanpa ucapan. Transkrip adalah contoh.</p>}
          <video key={video.id} ref={player} controls preload="metadata" src={video.id==='demo'?'/demo.mp4':`/api/videos/${video.id}/media`} onSeeking={()=>{const v=player.current;if(v && replayEnd.current!==null && v.currentTime*1000>replayEnd.current) replayEnd.current=null;}} onError={()=>setError('Video tidak dapat dimuat. Periksa backend atau codec MP4 (disarankan H.264/AAC).')} />
          <div className="video-meta"><span>{formatTime(video.duration*1000)} · {video.demo?'Demo':'MP4'}</span><span role="status">{states[video.status]??video.status}</span></div>
          {busy(video.status) && <div className="processing"><progress aria-label={states[video.status]}/><p>{states[video.status]}. Anda dapat membaca transkrip segera setelah tersedia.</p></div>}
          {video.error && <p className="error" role="status">{video.error}</p>}
          <div className="actions">
            {!video.demo && !busy(video.status) && <><button onClick={()=>void retry(true)} disabled={!video.segments.length}>Coba ulang terjemahan</button>{['error','interrupted'].includes(video.status) && <button onClick={()=>void retry(false)}>Coba ulang proses</button>}</>}
          </div>
          <details><summary>Cara belajar</summary><p>Klik dialog untuk memutar dari awal baris. Tombol ↻ memutar satu segmen lalu berhenti. Gunakan Tab dan Enter untuk navigasi keyboard.</p><p>Unggah MP4 Mandarin hingga {limits.max_upload_mb} MB / {Math.floor(limits.max_duration_seconds/60)} menit. Video dan koreksi disimpan di komputer ini.</p></details>
        </section>
        <section className="transcript" aria-label="Transkrip interaktif">
          <div className="transcript-head"><h2>Transkrip <span>{video.segments.length} segmen</span></h2><label className="check"><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/>Ikuti dialog</label></div>
          <div className="column-labels"><span>Mandarin & pinyin</span><span>Bahasa Indonesia</span></div>
          <div className="segments" ref={list}>
            {!video.segments.length && <p className="empty">Transkrip akan muncul setelah pengenalan ucapan selesai.</p>}
            {video.segments.map(s=><article data-segment={s.id} key={s.id} className={`segment ${active===s.id?'active':''}`} aria-current={active===s.id?'true':undefined}>
              <button className="dialog" onClick={()=>play(s)} aria-label={`Putar dari ${formatTime(s.start_ms)}: ${s.hanzi}`}><span className="time">{formatTime(s.start_ms)} – {formatTime(s.end_ms)}</span><span className="dialog-columns"><span className="hanzi" lang="zh">{s.units.map((u,i)=><ruby key={i}>{u.hanzi}<rt>{u.pinyin||' '}</rt></ruby>)}</span><span className="translation">{s.translation_id||'Menunggu terjemahan…'}{['stale','failed'].includes(s.translation_state)&&<em>{s.translation_state==='stale'?'Perlu diperbarui':'Belum diterjemahkan'}</em>}</span></span></button>
              <div className="row-actions"><button onClick={()=>play(s,true)} aria-label={`Putar ulang segmen ${formatTime(s.start_ms)}`}>↻ <span>Ulangi</span></button><button disabled={!!video.demo} onClick={()=>setEditing({...s})} aria-label={`Edit segmen ${formatTime(s.start_ms)}`}>Edit</button></div>
            </article>)}
          </div>
          <div className="export"><label>Ekspor<select defaultValue="" onChange={e=>{const kind=e.target.value;if(!kind)return;if(video.demo)exportDemo(kind);else window.location.href=`/api/videos/${video.id}/export?kind=${kind}`;e.target.value='';}}><option value="" disabled>Pilih format…</option><option value="txt">TXT · Semua teks</option><option value="srt-hanzi">SRT · Hanzi</option><option value="srt-id">SRT · Indonesia</option></select></label></div>
        </section>
      </div>
    </main>
    {editing && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title" onKeyDown={e=>{if(e.key==='Escape')setEditing(null);if(e.key==='Tab'){const elements=e.currentTarget.querySelectorAll<HTMLElement>('textarea,button');const first=elements[0],last=elements[elements.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}><h2 id="edit-title">Koreksi segmen</h2><form onSubmit={e=>void save(e)}><label>Hanzi<textarea lang="zh" autoFocus required maxLength={5000} value={editing.hanzi} onChange={e=>setEditing({...editing,hanzi:e.target.value})}/></label><label>Terjemahan Indonesia<textarea maxLength={10000} value={editing.translation_id} onChange={e=>setEditing({...editing,translation_id:e.target.value})}/></label><p>Pinyin diperbarui otomatis. Waktu segmen tetap dipertahankan.</p><div className="actions"><button type="button" onClick={()=>setEditing(null)}>Batal</button><button className="primary" disabled={saving}>{saving?'Menyimpan…':'Simpan koreksi'}</button></div></form></section></div>}
  </>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
