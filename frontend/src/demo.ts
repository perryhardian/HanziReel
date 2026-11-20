import type {Segment} from './sync';
const lines = [
  ['你好！今天你想做什么？','nǐ hǎo ！ jīn tiān nǐ xiǎng zuò shén me ？','Hi! What would you like to do today?'],
  ['我想去书店买一本书。','wǒ xiǎng qù shū diàn mǎi yì běn shū 。','I would like to buy a book at the bookstore.'],
  ['你喜欢看什么书？','nǐ xǐ huān kàn shén me shū ？','What kind of books do you like to read?'],
  ['我喜欢学习中文。一起去吧！','wǒ xǐ huān xué xí zhōng wén 。 yì qǐ qù ba ！','I like learning Chinese. Let’s go together!'],
];
export const demoSegments:Segment[] = lines.map(([hanzi,py,translation_id],i)=>({id:i+1,start_ms:i*4000,end_ms:(i+1)*4000,hanzi,translation_id,translation_state:'ready',units:[...hanzi].map((char,j)=>({hanzi:char,pinyin:/[\u3400-\u9fff]/.test(char)?py.split(' ')[j]:''}))}));
export const demoVideo = {id:'demo',name:'Conversation: today’s plans',duration:16,status:'ready',error:'',demo:1,translation_language:'en',segments:demoSegments};
