export type Segment = {id:number;start_ms:number;end_ms:number;hanzi:string;units:{hanzi:string;pinyin:string}[];translation_id:string;translation_state:string};
// Half-open intervals: at a shared boundary, the next segment wins.
export function activeSegment(segments:Segment[], ms:number) {
  return segments.find(s => ms >= s.start_ms && ms < s.end_ms)?.id ?? null;
}
export function formatTime(ms:number) {
  const seconds = Math.floor(ms/1000);
  return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
}
