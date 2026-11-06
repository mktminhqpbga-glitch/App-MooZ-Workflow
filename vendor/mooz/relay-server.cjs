'use strict';
const http=require('node:http'),{randomBytes,createHash,timingSafeEqual}=require('node:crypto'),{WebSocketServer,WebSocket}=require('ws');
const HEX=/^[a-f0-9]{64}$/,ORIGIN=/^chrome-extension:\/\/([a-p]{32})$/,FRAME=384*1024,BUFFER=2*1024*1024;
const hash=value=>createHash('sha256').update(String(value)).digest();
const equal=(value,digest)=>typeof value==='string'&&!!digest&&timingSafeEqual(hash(value),digest);
function createRelayServer({adminKey,port=0,host='127.0.0.1',maxRooms=4,leaseMs=600000,sessionMs=86400000,authMs=5000,heartbeatMs=20000}={}){
 if(typeof adminKey!=='string'||adminKey.length<32||adminKey.length>256||/[\s\x00-\x1f]/.test(adminKey))throw Error('RELAY_ADMIN_KEY must contain 32–256 non-whitespace characters.');
 const adminHash=hash(adminKey);adminKey=null;const rooms=new Map();let closing=false;
 const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');if(req.method==='GET'&&req.url==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:'mooz-outbound-relay',relayProtocol:1,maxFrame:FRAME}));}else{res.setHeader('Content-Type','text/plain');res.writeHead(req.url==='/remote'?426:404);res.end(req.url==='/remote'?'Upgrade Required':'Not found');}});
 server.headersTimeout=10000;server.requestTimeout=10000;
 const wss=new WebSocketServer({server,maxPayload:FRAME,perMessageDeflate:false,verifyClient:({origin,req})=>!closing&&wss.clients.size<24&&req.url==='/remote'&&(!origin||ORIGIN.test(origin))});
 function send(s,m,source){if(s?.readyState!==WebSocket.OPEN)return false;const data=JSON.stringify(m);if(s.bufferedAmount+Buffer.byteLength(data)>BUFFER){s.terminate();return false;}if(source)source._socket.pause();s.send(data,()=>{if(source&&!source._socket.destroyed)source._socket.resume();});return true;}
 function drop(room){if(!room||rooms.get(room.id)!==room)return;rooms.delete(room.id);if(room.owner.room===room)room.owner.room=null;if(room.guest){room.guest.room=null;room.guest.close(1008,'Room revoked');}send(room.owner,{type:'room-closed',room:room.id});room.inviteHash=null;room.resumeHash=null;}
 function peerGone(s){const room=s.room;s.room=null;if(!room)return;if(s.role==='host'){drop(room);return;}if(room.guest===s){room.guest=null;send(room.owner,{type:'peer-left',room:room.id,generation:room.generation});}}
 wss.on('connection',(s,req)=>{
  s.alive=true;s.role=null;s.room=null;s.origin=ORIGIN.exec(req.headers.origin||'')?.[1]||null;s.seq=0;s.part=0;s.total=0;
  s.on('pong',()=>{s.alive=true;});s.on('error',()=>{});
  const authTimer=setTimeout(()=>s.close(1008,'Authentication required'),authMs);authTimer.unref?.();
  let authBytes=0;const budget=b=>{if(!s.role&&(authBytes+=b.length)>8192)s.terminate();};req.socket.on('data',budget);
  s.on('close',()=>{clearTimeout(authTimer);req.socket.removeListener('data',budget);peerGone(s);});
  s.on('message',data=>{
   if(!s.role&&data.length>4096){s.close(1008,'Invalid authentication');return;}
   let m;try{m=JSON.parse(data.toString());}catch{s.close(1008,'Invalid message');return;}
   if(!m||typeof m!=='object'||Array.isArray(m)){s.close(1008,'Invalid message');return;}
   if(!s.role){
    if(m.relayProtocol!==1){s.close(1008,'Relay protocol required');return;}
    if(m.type==='host'&&!s.origin&&equal(m.key,adminHash)){s.role='host';clearTimeout(authTimer);req.socket.removeListener('data',budget);send(s,{type:'host-ready',relayProtocol:1});return;}
    const room=typeof m.room==='string'?rooms.get(m.room):null;
    if(m.type!=='join'||!s.origin||!room||room.expiresAt<=Date.now()||room.owner.readyState!==WebSocket.OPEN||!(typeof m.invite==='string'&&HEX.test(m.invite)&&room.leaseAt>Date.now()&&equal(m.invite,room.inviteHash)||typeof m.resume==='string'&&HEX.test(m.resume)&&equal(m.resume,room.resumeHash))){s.close(1008,'Pairing expired or revoked');return;}
    if(room.guest?.readyState===WebSocket.OPEN){s.close(1013,'Already connected');return;}
    s.role='guest';s.room=room;room.guest=s;room.inviteHash=null;room.generation=randomBytes(16).toString('hex');room.owner.seq=0;room.owner.part=0;room.owner.total=0;
    const session=randomBytes(32).toString('hex');room.resumeHash=hash(session);clearTimeout(authTimer);req.socket.removeListener('data',budget);
    send(room.owner,{type:'peer',room:room.id,generation:room.generation,extensionId:s.origin});send(s,{type:'joined',relayProtocol:1,room:room.id,generation:room.generation,resume:session});return;
   }
   if(m.type==='ping'){send(s,{type:'pong'});return;}
   if(m.type==='new-room'&&s.role==='host'&&typeof m.request==='string'&&/^[a-f0-9-]{36}$/.test(m.request)){
    if(s.room)drop(s.room);if(rooms.size>=maxRooms){send(s,{type:'room-error',request:m.request,message:'Relay room limit reached'});return;}
    const invite=randomBytes(32).toString('hex'),room={id:randomBytes(16).toString('hex'),owner:s,guest:null,generation:null,inviteHash:hash(invite),resumeHash:null,leaseAt:Date.now()+leaseMs,expiresAt:Date.now()+sessionMs};rooms.set(room.id,room);s.room=room;
    send(s,{type:'room',request:m.request,room:room.id,invite,expiresAt:room.leaseAt,leaseMs:Math.max(1,room.leaseAt-Date.now())});return;
   }
   if(m.type==='revoke'&&s.role==='host'){drop(s.room);return;}
   const room=s.room;if(m.type!=='data'||!room||rooms.get(room.id)!==room||!room.guest||room.owner.readyState!==WebSocket.OPEN||room.guest.readyState!==WebSocket.OPEN)return;
   if(m.generation!==room.generation)return; // Late frames from a previous peer never enter a new session.
   if(!Number.isSafeInteger(m.seq)||m.seq<1||!Number.isInteger(m.index)||!Number.isInteger(m.total)||m.total<1||m.total>684||m.index<0||m.index>=m.total||typeof m.iv!=='string'||!/^[A-Za-z0-9+/]{16}$/.test(m.iv)||typeof m.cipher!=='string'||m.cipher.length<24||m.cipher.length>262168||!/^[A-Za-z0-9+/]+={0,2}$/.test(m.cipher)){s.close(1008,'Invalid encrypted frame');return;}
   if(s.part===0){if(m.seq!==s.seq+1||m.index!==0){s.close(1008,'Invalid sequence');return;}s.seq=m.seq;s.total=m.total;}
   if(m.seq!==s.seq||m.index!==s.part||m.total!==s.total){s.close(1008,'Invalid sequence');return;}s.part++;if(s.part===s.total)s.part=0;
   const peer=s.role==='host'?room.guest:room.owner;send(peer,{type:'data',generation:room.generation,seq:m.seq,index:m.index,total:m.total,iv:m.iv,cipher:m.cipher},s);
  });
 });
 const interval=setInterval(()=>{for(const s of wss.clients){if(s.alive===false){s.terminate();continue;}s.alive=false;s.ping();}for(const room of rooms.values())if(room.expiresAt<=Date.now()||!room.guest&&!room.resumeHash&&room.leaseAt<=Date.now())drop(room);},heartbeatMs);interval.unref?.();
 return {server,wss,rooms,async listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});return server.address().port;},async close(){closing=true;clearInterval(interval);for(const room of [...rooms.values()])drop(room);for(const s of wss.clients)s.terminate();await new Promise(resolve=>wss.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
if(require.main===module){const relay=createRelayServer({adminKey:process.env.RELAY_ADMIN_KEY,port:Number(process.env.PORT||10000),host:'0.0.0.0'});relay.listen().then(()=>console.log('MooZ relay ready')).catch(()=>process.exit(1));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void relay.close().then(()=>process.exit(0));});}
module.exports={createRelayServer};
