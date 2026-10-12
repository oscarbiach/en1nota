import {writeFileSync,mkdirSync} from 'node:fs';
const mem=new Map();globalThis.localStorage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v),removeItem:k=>mem.delete(k)};
mem.set('en1nota.spotify.token',JSON.stringify({accessToken:'FAKE',refreshToken:'FAKE-REFRESH',expiresAt:Date.now()-1}));
globalThis.fetch=async()=>{throw new TypeError('Simulated offline');};
const {getAccessToken}=await import('../../src/spotify/auth.ts');let error;try{await getAccessToken();}catch(e){error=e.message;}
const result={id:'B08',name:'Fallo transitorio de refresh elimina sesión',error,tokenRetained:mem.has('en1nota.spotify.token')};
const output=process.env.AUDIT_OUT??'audit-output/segunda-auditoria';mkdirSync(output,{recursive:true});writeFileSync(`${output}/auth.json`,JSON.stringify(result,null,2));console.log(result);
