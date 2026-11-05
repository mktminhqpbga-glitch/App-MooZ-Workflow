'use strict';
const {WebSocket}=require('ws'),{randomBytes,randomUUID}=require('node:crypto');
const {EncryptedChannel,drain}=require('../chrome-relay-channel.js'),P=require('../chrome-remote-protocol.js'),D=require('../chrome-remote-diagnostics.js');
class OutboundRelay{
 constructor({relay,notify=()=>{},fetchImpl=globalThis.fetch,socketOptions=async()=>({}),WebSocketClass=WebSocket,startupMs=90000,heartbeatMs=20000,heartbeatTimeoutMs=65000}={}){Object.assign(this,{relay,notify,fetchImpl,socketOptions,WebSocketClass,startupMs,heartbeatMs,heartbeatTimeoutMs});this.ws=null;this.authenticated=false;this.endpoint=null;this.adminKey=null;this.room=null;this.channel=null;this.local=null;this.pendingRoom=null;this.error='';this.startedAt=null;this.epoch=0;this.heartbeat=null;this.lastReplyAt=0;this.lastPulseAt=0;this.seen=new Set();}
 get ready(){return !!this.authenticated&&this.ws?.readyState===WebSocket.OPEN;}
 status(){return {ready:this.ready,peer:!!this.channel,endpoint:this.endpoint,canReconnect:!!this.adminKey&&!this.ready,error:this.error};}
 changed(){this.notify(this.status());}
 send(m){if(this.ws?.readyState!==WebSocket.OPEN)throw Error('Máy chủ relay đã ngắt.');this.ws.send(JSON.stringify(m));}
 disposePeer(recoverable=false){this.channel?.close();this.channel=null;const local=this.local;this.local=null;local?.close(recoverable?4001:1000,recoverable?'Peer transport interrupted':'Disconnected');}
 lost(message){clearInterval(this.heartbeat);this.heartbeat=null;this.authenticated=false;this.disposePeer();this.room=null;this.error=message;const pending=this.pendingRoom;this.pendingRoom=null;if(pending){clearTimeout(pending.timer);pending.reject(Error(message));}this.changed();}
 pulse(ws){
  if(this.ws!==ws||!this.ready)return;const now=Date.now();
  // Give a resumed desktop one fresh probe instead of immediately timing out
  // because the operating system suspended JavaScript timers during sleep.
  if(now-this.lastPulseAt>this.heartbeatTimeoutMs)this.lastReplyAt=now;
  this.lastPulseAt=now;
  if(now-this.lastReplyAt>=this.heartbeatTimeoutMs){this.error='Relay không phản hồi. Kiểm tra mạng và trạng thái dịch vụ; kết nối lại rồi tạo mã ghép mới nếu máy chủ đã khởi động lại. Công việc AI không được tự gửi lại.';ws.terminate();return;}
  try{this.send({type:'ping'});}catch{this.error='Đường kết nối relay đã ngắt. Kiểm tra dịch vụ và kết nối lại.';ws.terminate();}
 }
 async start(endpoint,key){endpoint=P.relayEndpoint(endpoint);key=key||this.adminKey;if(typeof key!=='string'||key.length<32||key.length>256||/[\s\x00-\x1f]/.test(key))throw Error('Nhập RELAY_ADMIN_KEY từ dịch vụ Render (32–256 ký tự). Không gửi khóa vào chat.');await this.stop();const epoch=++this.epoch;this.endpoint=endpoint;this.adminKey=key;this.error='';this.startedAt=Date.now();this.changed();
  let health;const deadline=Date.now()+this.startupMs;do{health=await D.checkRelay(endpoint,{fetchImpl:this.fetchImpl,timeoutMs:Math.min(10000,Math.max(1,deadline-Date.now()))});if(this.epoch!==epoch)throw Error('Đã dừng kết nối relay.');if(health.ok||health.code==='blocked'||[401,403,404].includes(health.status)||Date.now()+5000>=deadline)break;await new Promise(resolve=>setTimeout(resolve,5000));}while(Date.now()<deadline);if(!health.ok){this.error=health.message;this.changed();throw Error(health.message);}
  const options=await this.socketOptions(endpoint);if(this.epoch!==epoch)throw Error('Đã dừng kết nối relay.');return new Promise((resolve,reject)=>{
   const ws=new this.WebSocketClass(endpoint,{...options,maxPayload:384*1024,perMessageDeflate:false,handshakeTimeout:this.startupMs});this.ws=ws;let settled=false;
   const timeout=setTimeout(()=>{this.error='Máy chủ relay chưa phản hồi. Kiểm tra dịch vụ Live, khóa quản trị và mạng.';ws.terminate();},this.startupMs);timeout.unref?.();
   ws.on('open',()=>ws.send(JSON.stringify({type:'host',relayProtocol:1,key})));
   ws.on('message',bytes=>{
    if(this.ws!==ws)return;let m;try{m=JSON.parse(bytes.toString());}catch{ws.close(1008,'Invalid relay reply');return;}
    if(m.type==='host-ready'&&!settled){if(m.relayProtocol!==1){ws.close(1008,'Relay protocol required');return;}settled=true;clearTimeout(timeout);this.authenticated=true;this.error='';this.lastReplyAt=Date.now();this.lastPulseAt=this.lastReplyAt;this.heartbeat=setInterval(()=>this.pulse(ws),this.heartbeatMs);this.heartbeat.unref?.();this.changed();resolve(this.status());return;}
    if(!this.authenticated)return;
    this.lastReplyAt=Date.now();
    if(m.type==='room'&&m.request===this.pendingRoom?.id){const p=this.pendingRoom;this.pendingRoom=null;clearTimeout(p.timer);if(typeof m.room!=='string'||typeof m.invite!=='string'||!/^[a-f0-9]{32}$/.test(m.room||'')||!/^[a-f0-9]{64}$/.test(m.invite||'')||!Number.isSafeInteger(m.expiresAt)||m.expiresAt<=0||m.expiresAt>8640000000000000||m.leaseMs!==undefined&&(!Number.isInteger(m.leaseMs)||m.leaseMs<1||m.leaseMs>15*60*1000)){p.reject(Error('Máy chủ trả mã phòng chưa hợp lệ.'));return;}this.disposePeer();this.room={room:m.room,invite:m.invite,expiresAt:Date.now()+Math.max(1,(m.leaseMs??600000)-(Date.now()-p.startedAt)),relayKey:randomBytes(32).toString('hex')};p.resolve({...this.room});return;}
    if(m.type==='room-error'&&m.request===this.pendingRoom?.id){const p=this.pendingRoom;this.pendingRoom=null;clearTimeout(p.timer);p.reject(Error('Máy chủ relay đã hết số phòng cho phép. Kiểm tra các app đang kết nối.'));return;}
    if(m.type==='room-closed'&&m.room===this.room?.room){this.disposePeer();this.room=null;this.changed();return;}
    if(m.type==='peer-left'&&m.room===this.room?.room){this.disposePeer(true);this.changed();return;}
    if(m.type==='peer'&&m.room===this.room?.room){this.peer(m,ws);return;}
    if(m.type==='data'&&m.generation===this.generation&&this.channel)void this.channel.receive(m).catch(()=>{});
   });
   ws.on('unexpected-response',(_q,res)=>{if(this.ws!==ws){res.resume();return;}this.error='Máy chủ relay trả HTTP '+res.statusCode+'. Kiểm tra dịch vụ và quyền truy cập mạng.';res.resume();ws.terminate();});
   ws.on('error',()=>{if(this.ws!==ws)return;if(!this.error)this.error='Chưa kết nối được máy chủ relay qua WSS. Kiểm tra TLS, proxy/mạng và dịch vụ Live.';});
   ws.on('close',code=>{clearTimeout(timeout);if(this.ws!==ws){if(!settled){settled=true;reject(Error('Đã dừng kết nối relay.'));}return;}this.ws=null;this.lost(this.error||(code===1008?'Khóa quản trị hoặc giao thức relay chưa hợp lệ.':'Relay đã ngắt. Kết nối lại app, tạo mã mới; không tự gửi lại công việc AI.'));if(!settled){settled=true;reject(Error(this.error));}});
  });
 }
 peer(m,ws){
  if(typeof m.generation!=='string'||typeof m.extensionId!=='string'||!/^[a-f0-9]{32}$/.test(m.generation||'')||!/^[a-p]{32}$/.test(m.extensionId||'')||this.seen.has(m.generation)||this.seen.size>2048){ws.close(1008,'Invalid peer');return;}
  this.seen.add(m.generation);this.disposePeer();this.generation=m.generation;const queue=[];let queued=0;
  const local=new WebSocket('ws://127.0.0.1:'+this.relay.remoteIngressPort+'/remote',{origin:'chrome-extension://'+m.extensionId,maxPayload:128*1024*1024,perMessageDeflate:false});this.local=local;
  const channel=new EncryptedChannel({key:this.room.relayKey,room:this.room.room,generation:m.generation,role:'host',send:async frame=>{if(this.ws!==ws||this.channel!==channel)throw Error('Phiên relay đã đổi.');await drain(ws);ws.send(JSON.stringify(frame));},deliver:async text=>{if(this.local!==local)return;if(local.readyState===WebSocket.OPEN)local.send(text);else{queued+=Buffer.byteLength(text);if(queued>32768||queue.length>8)throw Error('Chưa xác thực được Chrome qua relay.');queue.push(text);}},error:()=>{if(this.local===local){local.terminate();this.disposePeer();}}});this.channel=channel;
  local.on('open',()=>{if(this.local===local){for(const text of queue)local.send(text);queue.length=0;}});
  local.on('message',bytes=>{if(this.local===local)void channel.send(bytes.toString()).catch(()=>{});});
  local.on('error',()=>{});local.on('close',code=>{if(this.local===local){void channel.send(JSON.stringify({type:'relay-close',code})).catch(()=>{}).finally(()=>{if(this.local===local){this.disposePeer();this.changed();}});}});this.changed();
 }
 newRoom(){if(!this.ready)return Promise.reject(Error('Kết nối máy chủ relay trước khi tạo mã.'));if(this.pendingRoom)return Promise.reject(Error('Đang tạo mã relay.'));return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{if(this.pendingRoom?.id===id)this.pendingRoom=null;reject(Error('Relay chưa tạo được phòng. Thử lại sau khi kiểm tra dịch vụ.'));},10000);timer.unref?.();this.pendingRoom={id,timer,resolve,reject,startedAt:Date.now()};this.send({type:'new-room',request:id});});}
 revoke(){if(this.ready)this.send({type:'revoke'});this.disposePeer();this.room=null;this.changed();}
 async stop(){this.epoch++;clearInterval(this.heartbeat);this.heartbeat=null;const ws=this.ws;this.ws=null;this.adminKey=null;this.authenticated=false;this.disposePeer();this.room=null;this.seen.clear();const p=this.pendingRoom;this.pendingRoom=null;if(p){clearTimeout(p.timer);p.reject(Error('Đã dừng relay.'));}if(ws){ws.close(1000,'Disconnected');const timer=setTimeout(()=>ws.terminate(),1000);timer.unref?.();ws.once('close',()=>clearTimeout(timer));}this.changed();}
}
module.exports={OutboundRelay};
