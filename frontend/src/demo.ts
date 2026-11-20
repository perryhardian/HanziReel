import type {Segment} from './sync';
const lines = [
  ['你好！今天你想做什么？','nǐ hǎo ！ jīn tiān nǐ xiǎng zuò shén me ？','Halo! Hari ini kamu ingin melakukan apa?'],
  ['我想去书店买一本书。','wǒ xiǎng qù shū diàn mǎi yì běn shū 。','Aku ingin pergi ke toko buku untuk membeli sebuah buku.'],
  ['你喜欢看什么书？','nǐ xǐ huān kàn shén me shū ？','Kamu suka membaca buku apa?'],
  ['我喜欢学习中文。一起去吧！','wǒ xǐ huān xué xí zhōng wén 。 yì qǐ qù ba ！','Aku suka belajar bahasa Mandarin. Ayo pergi bersama!'],
];
export const demoSegments:Segment[] = lines.map(([hanzi,py,translation_id],i)=>({id:i+1,start_ms:i*4000,end_ms:(i+1)*4000,hanzi,translation_id,translation_state:'ready',units:[...hanzi].map((char,j)=>({hanzi:char,pinyin:/[\u3400-\u9fff]/.test(char)?py.split(' ')[j]:''}))}));
export const demoVideo = {id:'demo',name:'Percakapan: rencana hari ini',duration:16,status:'ready',error:'',demo:1,segments:demoSegments};
