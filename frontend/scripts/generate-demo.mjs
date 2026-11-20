// Original synthetic fixture; no third-party footage, speech, or music.
import ffmpeg from 'ffmpeg-static';
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
mkdirSync(new URL('../public/',import.meta.url),{recursive:true});
const output = new URL('../public/demo.mp4',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const boxes=Array.from({length:4},(_,i)=>`drawbox=x=${160+i*170}:y=220:w=120:h=100:color=0xb45309:t=fill:enable='gte(t,${i*4})*lt(t,${(i+1)*4})'`).join(',');
const result=spawnSync(ffmpeg,['-y','-loglevel','error','-f','lavfi','-i','color=c=0x292524:s=960x540:r=25:d=16','-f','lavfi','-i','sine=frequency=440:sample_rate=44100:duration=16','-vf',`drawgrid=width=120:height=90:thickness=1:color=0x51483f,${boxes}`,'-af',"volume=0.08,afade=t=in:d=0.1,afade=t=out:st=15.7:d=0.3",'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-shortest',output],{stdio:'inherit'});
process.exit(result.status??1);
