'use strict';
const {randomBytes,timingSafeEqual,randomUUID}=require('node:crypto');
const {WebSocketServer,WebSocket}=require('ws');
const http=require('node:http');
const Remote=require('../chrome-remote-protocol.js');
const MAX_BYTES=128*1024*1024;
const OPERATIONS=new Set(['tabs.query','tabs.get','tabs.focus','tabs.script','tabs.message','shopee.open','shopee.tabs','shopee.read']);
const EXTENSION_ORIGIN=/^chrome-extension:\/\/([a-p]{32})$/;

class ChromeRelay {
 constructor(options={}) {
  this.notify=typeof options==='function'?options:options.notify||(()=>{});
  this.appVersion=typeof options==='object'?options.version||null:null;this.companion=null;
  this.recoveryMs=options.recoveryMs??90000;this.recovery=null;this.resultRecovery=false;
  this.instanceId=randomUUID();this.remoteHttp=null;this.server=null;this.remoteServer=null;this.remoteIngressPort=null;this.client=null;this.extensionId=null;this.port=null;this.token=null;this.pending=new Map();this.remoteEndpoint=null;this.remoteLease=null;this.remoteSession=null;this.connectionMode=null;this.heartbeat=null;
 }
 get isConnected(){return this.client?.readyState===WebSocket.OPEN;}
 dispatchKey(id){return this.tabKey?this.tabKey(id):'chrome:'+id;}
 status(){return {connected:!!this.isConnected,port:this.port,extensionId:this.extensionId,companion:this.companion,mode:this.connectionMode,remoteEnabled:!!this.remoteEndpoint,recovering:!!this.recovery,recoveryUntil:this.recovery?.until||null};}
 async start({port=0}={}){
  if(this.server)return this.status();
  this.token=randomBytes(32).toString('hex');
  const server=new WebSocketServer({host:'127.0.0.1',port,maxPayload:MAX_BYTES,perMessageDeflate:false,verifyClient:({origin,req})=>EXTENSION_ORIGIN.test(origin||'')&&server.clients.size<16&&(req.url==='/'||!!this.remoteEndpoint&&['/remote',new URL(this.remoteEndpoint).pathname].includes(req.url))});
  this.server=server;
  server.on('connection',(socket,request)=>this.accept(socket,request));
  try{await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});}catch(e){this.server=null;throw e;}this.heartbeat=setInterval(()=>{for(const s of [...server.clients,...(this.remoteServer?.clients||[])]){if(s.alive===false){s.terminate();continue;}s.alive=false;s.ping();}},20000);this.heartbeat.unref?.();
  this.port=server.address().port;return this.status();
 }
 async startRemoteIngress({port=0}={}){
  if(this.remoteServer)return this.remoteIngressPort;
  // Public tunnels target a separate loopback listener: '/' and local pairing
  // credentials are never exposed through the Cloudflare ingress.
  const listener=http.createServer((req,res)=>{
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
   let url;try{url=new URL(req.url,'http://127.0.0.1');}catch{res.writeHead(400).end();return;}
   if(req.method==='GET'&&url.pathname==='/remote/health'&&/^[a-f0-9]{32}$/.test(url.searchParams.get('probe')||'')&&req.url.length<150){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:'mooz-chrome-relay',protocol:1,instance:this.instanceId,probe:url.searchParams.get('probe')}));return;}
   res.setHeader('Content-Type','text/plain; charset=utf-8');res.writeHead(url.pathname==='/remote'?426:404);res.end(url.pathname==='/remote'?'Upgrade Required':'Not found');
  });
  this.remoteHttp=listener;
  const server=new WebSocketServer({server:listener,maxPayload:MAX_BYTES,perMessageDeflate:false,verifyClient:({origin,req})=>EXTENSION_ORIGIN.test(origin||'')&&server.clients.size<16&&!!this.remoteEndpoint&&req.url==='/remote'});
  this.remoteServer=server;server.on('connection',(socket,request)=>this.accept(socket,request));
  try{await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(port,'127.0.0.1',resolve);});}catch(e){server.close();this.remoteServer=null;this.remoteHttp=null;throw e;}
  this.remoteIngressPort=listener.address().port;return this.remoteIngressPort;
 }
 pairingURI(){if(!this.port||!this.token)throw Error('Kết nối Chrome chưa được khởi tạo.');return `workflow-connect://127.0.0.1:${this.port}/${this.token}`;}
 configureRemote(value){const next=value?Remote.endpoint(value):null;if(next===this.remoteEndpoint)return;this.revokeRemote();this.remoteEndpoint=next;this.changed();}
 remotePairingURI(){if(!this.remoteEndpoint)throw Error('Bật kết nối từ xa trước khi tạo mã.');this.remoteLease={token:randomBytes(32).toString('hex'),expiresAt:Date.now()+10*60*1000};return {url:Remote.pairing(this.remoteEndpoint,this.remoteLease.token,this.remoteLease.expiresAt),expiresAt:this.remoteLease.expiresAt};}
 revokeLocal(){this.token=randomBytes(32).toString('hex');if(this.connectionMode==='local'||this.recovery?.mode==='local')this.disconnect();this.changed();}
 revokeRemote(){this.remoteLease=null;this.remoteSession=null;if(this.connectionMode==='remote'||this.recovery?.mode==='remote')this.disconnect();this.changed();}
 changed(){try{this.notify({type:'relay',...this.status()});}catch{}}
 send(socket,value){
  const text=JSON.stringify(value);
  if(Buffer.byteLength(text)>MAX_BYTES||socket.bufferedAmount+Buffer.byteLength(text)>MAX_BYTES){socket.terminate();throw Error('Dữ liệu kết nối Chrome vượt giới hạn 128 MB.');}
  socket.send(text);
 }
 accept(socket,request){
  let authenticated=false;const remote=request.url!=='/';socket.alive=true;socket.on('pong',()=>{socket.alive=true;});
  // Bound unauthenticated traffic before a large/fragmented WebSocket message
  // has been assembled. The public ingress must not buffer 128 MB to reject it.
  let authBytes=0;const budget=chunk=>{if(authenticated)return;authBytes+=chunk.length;if(authBytes>8192)socket.terminate();};
  request.socket?.on('data',budget);
  const authTimer=setTimeout(()=>socket.close(1008,'Authentication required'),remote?15000:5000);authTimer.unref?.();
  socket.on('error',()=>{});
  socket.on('close',code=>{request.socket?.removeListener('data',budget);clearTimeout(authTimer);if(this.client===socket)this.clearClient({recoverable:this.resultRecovery&&[1001,1005,1006,1011,1012,1013,4001].includes(code)});});
  socket.on('message',bytes=>{
   if(!authenticated&&bytes.length>4096){socket.close(1008,'Invalid authentication');return;}let message;try{message=JSON.parse(bytes.toString());}catch{socket.close(1008,'Invalid message');return;}
   if(!message||typeof message!=='object'||Array.isArray(message)){socket.close(1008,'Invalid message');return;}
   if(!authenticated){
    const supplied=typeof message.token==='string'&&/^[a-f0-9]{64}$/.test(message.token)?Buffer.from(message.token,'hex'):null;
    const allowed=remote?[this.remoteSession,this.remoteLease&&this.remoteLease.expiresAt>Date.now()?this.remoteLease.token:null].filter(Boolean):[this.token].filter(Boolean);
    if(message.type!=='auth'||!supplied||!allowed.some(token=>timingSafeEqual(supplied,Buffer.from(token,'hex')))||remote&&(!this.remoteEndpoint||message.remoteProtocol!==1)){socket.close(1008,'Authentication failed or pairing expired');return;}
    if(this.isConnected){socket.close(1013,'Already connected');return;}
    if(message.protocol!==undefined&&message.protocol!==1){socket.close(1008,'Companion protocol update required');return;}
    const extensionId=EXTENSION_ORIGIN.exec(request.headers.origin)[1];
    if(this.recovery&&(this.recovery.extensionId!==extensionId||this.recovery.mode!==(remote?'remote':'local'))){socket.close(1008,'Resume identity required');return;}
    const recovery=this.recovery;if(recovery){clearTimeout(recovery.timer);this.recovery=null;}
    this.resultRecovery=message.resultRecovery===1;
    authenticated=true;request.socket?.removeListener('data',budget);clearTimeout(authTimer);this.client=socket;this.connectionMode=remote?'remote':'local';if(remote){this.remoteLease=null;this.remoteSession=randomBytes(32).toString('hex');}this.extensionId=EXTENSION_ORIGIN.exec(request.headers.origin)[1];
    this.companion={protocol:message.protocol||1,version:typeof message.extensionVersion==='string'&&/^\d+\.\d+\.\d+$/.test(message.extensionVersion)?message.extensionVersion:null};
    this.send(socket,{type:'ready',protocol:1,appVersion:this.appVersion,...(this.resultRecovery?{resultRecovery:1,recoveryMs:this.recoveryMs,pendingRequests:recovery?[...this.pending.keys()]:[]}:{}),...(remote?{remoteProtocol:1,sessionToken:this.remoteSession}:{})});if(recovery){if(!this.resultRecovery)this.failPending();for(const waiter of recovery.waiters)waiter.resolve();}this.changed();return;
   }
   if(socket!==this.client)return;
   if(message.type==='ping'){try{this.send(socket,{type:'pong'});}catch{}return;}
   if(message.type==='gate'&&typeof message.callId==='string'&&/^[a-f0-9-]{36}$/.test(message.callId)&&Number.isInteger(message.tabId)&&JSON.stringify(message.message||{}).length<2000){
    void Promise.resolve(this.dispatch?.gate(this.dispatchKey(message.tabId),message.message)||{ok:false,error:'App chưa hỗ trợ điều phối gửi.'}).then(result=>{if(socket===this.client)this.send(socket,{type:'gate-result',callId:message.callId,result});}).catch(()=>{});return;
   }
   if(message.type==='response'&&typeof message.id==='string'){
    if(this.resultRecovery){try{this.send(socket,{type:'response-ack',id:message.id});}catch{}}
    const item=this.pending.get(message.id);if(!item)return;clearTimeout(item.timer);this.pending.delete(message.id);
    if(typeof message.error==='string')item.reject(Error(message.error));else item.resolve(message.result);
   }else if(message.type==='notification'){
    const event=message.event;
    if(!event||!['message','created','updated','removed'].includes(event.type))return;
    if(event.type==='message'&&(event.message?.type!=='WORKFLOW_AI_PROGRESS'||typeof event.message.requestId!=='string'||typeof event.message.text!=='string'||!Number.isInteger(event.tabId)))return;
    if(event.type==='removed'&&Number.isInteger(event.tabId))void this.dispatch?.disconnect(this.dispatchKey(event.tabId));
    try{this.notify(event);}catch{}
   }
  });
 }
 clearClient({recoverable=false}={}){
  const identity={extensionId:this.extensionId,mode:this.connectionMode};
  this.client=null;this.extensionId=null;this.companion=null;this.connectionMode=null;this.resultRecovery=false;
  if(recoverable){
   const recovery={...identity,until:Date.now()+this.recoveryMs,waiters:[]};this.recovery=recovery;
   recovery.timer=setTimeout(()=>{if(this.recovery!==recovery)return;this.recovery=null;this.failPending();for(const waiter of recovery.waiters)waiter.reject(Error('Chrome chưa nối lại trong thời gian cho phép. Kiểm tra kết quả trên tab AI trước khi chạy lại.'));this.changed();},this.recoveryMs);recovery.timer.unref?.();
  }else{this.cancelRecovery();this.failPending();}
  this.changed();
 }
 cancelRecovery(){const recovery=this.recovery;if(!recovery)return;this.recovery=null;clearTimeout(recovery.timer);for(const waiter of recovery.waiters)waiter.reject(Error('Chrome đã ngắt kết nối.'));}
 failPending(){
  for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(Error('Chrome đã ngắt kết nối. Kiểm tra tab AI trước khi chạy lại; không tự gửi lại yêu cầu.'));}
  this.pending.clear();for(const key of new Set([...this.dispatch?.records.values()||[]].filter(r=>r.key.startsWith('chrome:')&&(!this.ownsTabKey||this.ownsTabKey(r.key))).map(r=>r.key)))void this.dispatch.disconnect(key);
 }
 async request(operation,payload={}){
  if(this.dispatch&&operation==='tabs.message'){
   let provider=this.dispatch.find(this.dispatchKey(payload.id),payload.message?.requestId)?.provider;
   if(!provider&&['WORKFLOW_AI_GENERATE','MUSEFLOW_GENERATE','MUSEFLOW_JOB_START','WORKFLOW_AI_CHECK','MUSEFLOW_CHECK_SESSION'].includes(payload.message?.type)){const tab=await this.rawRequest('tabs.get',{id:payload.id});provider=require('./policy.cjs').providerForURL(tab.url);}
   if(provider)return this.dispatch.invoke(this.dispatchKey(payload.id),provider,payload.message,message=>this.rawRequest(operation,{...payload,message}));
  }
  return this.rawRequest(operation,payload);
 }
 rawRequest(operation,payload={}){
  if(!OPERATIONS.has(operation))return Promise.reject(Error('Thao tác Chrome không được phép.'));
  if(!this.isConnected&&this.recovery){if(operation==='tabs.message'&&['WORKFLOW_AI_GENERATE','MUSEFLOW_GENERATE','MUSEFLOW_JOB_START'].includes(payload?.message?.type))return Promise.reject(Error('Chrome đang nối lại; chưa gửi yêu cầu AI mới.'));if(this.recovery.waiters.length>=64)return Promise.reject(Error('Có quá nhiều yêu cầu Chrome đang chờ nối lại.'));return new Promise((resolve,reject)=>this.recovery.waiters.push({resolve,reject})).then(()=>this.rawRequest(operation,payload));}
  if(!this.isConnected)return Promise.reject(Error('Chưa kết nối tiện ích Workflow trong Chrome.'));
  if(this.pending.size>=64)return Promise.reject(Error('Có quá nhiều yêu cầu Chrome đang chờ.'));
  const id=randomUUID(),timeout=operation==='shopee.read'?90000:operation==='tabs.message'&&/GENERATE|JOB_START/.test(payload?.message?.type||'')?11*60*1000:this.connectionMode==='remote'?60000:30000;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Chrome chưa trả kết quả trong thời gian cho phép. Kiểm tra tab AI trước khi chạy lại.'));},timeout);timer.unref?.();
   this.pending.set(id,{resolve,reject,timer});
   try{this.send(this.client,{type:'request',id,operation,payload});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
  });
 }
 disconnect(){if(this.recovery){this.cancelRecovery();this.failPending();this.changed();}if(this.client){const socket=this.client;this.clearClient();socket.close(1000,'Disconnected');}}
 async close(){
  clearInterval(this.heartbeat);this.heartbeat=null;this.revokeRemote();this.remoteEndpoint=null;this.disconnect();const server=this.server;this.server=null;this.token=null;this.port=null;
  const remote=this.remoteServer;this.remoteServer=null;this.remoteIngressPort=null;
  for(const target of [server,remote].filter(Boolean)){for(const socket of target.clients)socket.terminate();await new Promise(resolve=>target.close(resolve));}
  const listener=this.remoteHttp;this.remoteHttp=null;if(listener){listener.closeAllConnections();await new Promise(resolve=>listener.close(resolve));}
 }
}
module.exports={ChromeRelay};
