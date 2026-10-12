import {registerHooks,stripTypeScriptTypes} from 'node:module';
import {readFileSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL?.startsWith('file:')){const u=new URL(s,c.parentURL);if(!/\.[a-z]+$/i.test(u.pathname)&&existsSync(fileURLToPath(u)+'.ts'))return next(u.href+'.ts',c);}return next(s,c);},load(u,c,next){if(u.endsWith('.ts'))return{format:'module',source:stripTypeScriptTypes(readFileSync(new URL(u),'utf8'),{mode:'transform'}),shortCircuit:true};return next(u,c);}});
const results=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));
const output=process.env.AUDIT_OUT??'audit-output/segunda-auditoria';mkdirSync(output,{recursive:true});
globalThis.window=globalThis;
const mem=new Map();globalThis.localStorage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v),removeItem:k=>mem.delete(k)};
mem.set('en1nota.spotify.token',JSON.stringify({accessToken:'FAKE-LOCAL-ONLY',expiresAt:Date.now()+3600000}));
const {SdkPlayer}=await import('../../src/spotify/player.ts');
const sdk=new SdkPlayer();let resolved=false;const waiting=sdk.waitPlaying('spotify:track:expected',100);
waiting.then(()=>resolved=true,()=>{});sdk.stateWaiters[0]({paused:false,position:90000,track_window:{current_track:{uri:'spotify:track:old'}}});await delay(0);
results.push({id:'B01',name:'SDK acepta evento de otro tema',resolvedWithWrongTrack:resolved});
const api=await import('../../src/spotify/api.ts');
globalThis.fetch=async()=>new Response(JSON.stringify({items:[{item:{id:'episode1',uri:'spotify:episode:1',name:'Podcast',duration_ms:1000,type:'episode'}}],next:null}),{status:200});
try{await api.playlistTracks('testplaylist123456');results.push({id:'B05',unexpected:'no error'});}catch(e){results.push({id:'B05',name:'Playlist con episodio',error:e.message});}
globalThis.fetch=async()=>new Response(JSON.stringify({devices:[]}),{status:200});
const {savePlaylist,loadPlaylists}=await import('../../src/storage/store.ts');
const original=localStorage.setItem;localStorage.setItem=()=>{throw new DOMException('Full','QuotaExceededError');};
let thrown=false;try{savePlaylist({id:'x',name:'Lista',tracks:[],updatedAt:Date.now()});}catch{thrown=true;}
results.push({id:'B04',name:'Cuota de almacenamiento agotada',errorCommunicated:thrown,saved:loadPlaylists().some(p=>p.id==='x')});localStorage.setItem=original;
const E=await import('../../src/game/engine.ts');let g=E.newGame({tracks:[{id:'1',uri:'manual:1',name:'Tema',artists:'',album:'',durationMs:1000,startMs:0}]});g=E.addPlayer(g,'A','a');g=E.startGame(g);g=E.markPlaying(g,10000);g=E.receiveBuzz(g,{playerId:'a',at:15300});g=E.resolveBuzzes(g);results.push({id:'B03',name:'Reloj servidor 5 segundos adelantado',actualReactionMs:300,reportedReactionMs:g.round.events.at(-1).reactionMs});
console.log(JSON.stringify(results,null,2));writeFileSync(`${output}/runtime.json`,JSON.stringify(results,null,2));
