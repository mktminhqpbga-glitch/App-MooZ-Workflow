import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {execFileSync} from 'node:child_process';import {createServer,request} from 'node:https';
import {WebSocket} from 'ws';
import {RelaySettings} from '../server/relay-settings.mjs';
import {ChromeConnection} from '../server/connection.mjs';
import relayServer from '../vendor/mooz/relay-server.cjs';
import channels from '../vendor/mooz/chrome-relay-channel.js';
import protocol from '../vendor/mooz/chrome-remote-protocol.js';
const KEY='fixture-'+ 'a'.repeat(48);
test('relay config persists privately, keeps hidden key, validates modes/TLS and explicit endpoint changes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mooz-config-'));try{
 const settings=new RelaySettings(dir,{});await settings.init();assert.deepEqual(settings.snapshot(),{mode:'local',endpoint:'',keyConfigured:false});
 for(const input of [{mode:'bad'},{mode:'relay',endpoint:'http://example.com',key:KEY},{mode:'relay',endpoint:'wss://example.com/remote',key:'short'},{mode:'relay',endpoint:'wss://user:pass@example.com/remote',key:KEY}])assert.throws(()=>settings.resolve(input));
 await settings.save(settings.resolve({mode:'relay',endpoint:'https://relay.example.com',key:KEY}));
 assert.equal(settings.snapshot().endpoint,'wss://relay.example.com/remote');assert.equal(JSON.stringify(settings.snapshot()).includes(KEY),false);
 assert.equal((await stat(settings.file)).mode&0o777,0o600);
 const restarted=new RelaySettings(dir,{MOOZ_RELAY_URL:'wss://other.example.com/remote',MOOZ_RELAY_KEY:'b'.repeat(48)});await restarted.init();assert.deepEqual(restarted.snapshot(),settings.snapshot());
 assert.equal(restarted.resolve({mode:'relay',endpoint:restarted.snapshot().endpoint,key:''}).key,KEY);
 assert.throws(()=>restarted.resolve({mode:'relay',endpoint:'wss://other.example.com/remote',key:''}),/khóa cho địa chỉ/);
 await restarted.save(restarted.resolve({mode:'local',clear:true}));assert.equal((await readFile(restarted.file,'utf8')).includes(KEY),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('saved relay authenticates real TLS/WSS, creates remote pairing and encrypted companion returns tabs; local switch revokes room',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mooz-relay-tls-'));let connection,secure,broker,guest;
 try{
 await writeFile(join(dir,'cert.cnf'),'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','2','-config',join(dir,'cert.cnf')],{stdio:'ignore'});
 const ca=await readFile(join(dir,'cert.pem'));
 broker=relayServer.createRelayServer({adminKey:KEY,authMs:1000});await broker.listen();
 secure=createServer({key:await readFile(join(dir,'key.pem')),cert:ca},(req,res)=>broker.server.emit('request',req,res));secure.on('upgrade',(...args)=>broker.server.emit('upgrade',...args));await new Promise(r=>secure.listen(0,'127.0.0.1',r));
 const endpoint='wss://127.0.0.1:'+secure.address().port+'/remote';
 const fetchTLS=url=>new Promise((resolve,reject)=>{const req=request(url,{ca},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode})));});req.on('error',reject);req.end();});
 connection=new ChromeConnection(dir,{}, {brokerOptions:{fetchImpl:fetchTLS,socketOptions:async()=>({ca}),startupMs:1500}});await connection.init();
 await connection.configure({mode:'relay',endpoint,key:KEY});assert.equal(connection.status().remoteConfigured,true);
 const snapshot=JSON.stringify(connection.settings.snapshot());
 await assert.rejects(connection.testRelay({mode:'relay',endpoint,key:'wrong-'+ 'z'.repeat(40)}),/Khóa|giao thức/);
 assert.equal(JSON.stringify(connection.settings.snapshot()),snapshot,'failed test does not overwrite saved key');
 assert.equal((await connection.testRelay({mode:'relay',endpoint,key:''})).ok,true);assert.equal(broker.rooms.size,0,'test does not create pairing rooms');
 const pair=await connection.pair();assert.equal(pair.mode,'remote');const next=protocol.parseURI(pair.uri);assert.equal(next.mode,'relay');
 class GuestSocket extends WebSocket{constructor(url){super(url,{ca,origin:'chrome-extension://'+'a'.repeat(32)});}}
 guest=new channels.RelaySocket(next,'a'.repeat(32),{WebSocketClass:GuestSocket});
 await new Promise((resolve,reject)=>{guest.onopen=()=>guest.send(JSON.stringify({type:'auth',protocol:1,remoteProtocol:1,token:next.token,extensionVersion:'1.9.2'}));guest.onmessage=event=>{const message=JSON.parse(event.data);if(message.type==='ready')resolve();else if(message.type==='request')guest.send(JSON.stringify({type:'response',id:message.id,result:[{id:19,title:'VM Grok',url:'https://grok.com/chat/fixture'}]}));};guest.onerror=()=>reject(Error('Guest TLS transport failed'));guest.onclose=()=>reject(Error('Guest closed before ready'));});
 assert.equal(connection.status().connected,true);assert.equal((await connection.tabs('grok'))[0].title,'VM Grok');
 assert.equal(JSON.stringify(connection.status()).includes(KEY),false);
 await connection.configure({mode:'local',endpoint,key:''});assert.equal(connection.status().connected,false);assert.equal(connection.status().remoteConfigured,false);
 for(let i=0;i<50&&broker.rooms.size;i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(broker.rooms.size,0);const local=await connection.pair();assert.equal(local.mode,'local');assert.equal(protocol.parseURI(local.uri).mode,undefined);
 }finally{guest?.close();await connection?.close();await broker?.close();if(secure){secure.closeAllConnections();await new Promise(r=>secure.close(r));}await rm(dir,{recursive:true,force:true});}
});

test('invalid saved/environment relay can be corrected from Settings without preventing app startup',async()=>{const dir=await mkdtemp(join(tmpdir(),'mooz-invalid-config-'));try{await writeFile(join(dir,'chrome-connection.json'),'corrupt');const settings=new RelaySettings(dir,{});await settings.init();assert.ok(settings.snapshot().error);await settings.save(settings.resolve({mode:'local',clear:true}));assert.equal(settings.snapshot().error,undefined);const empty=await mkdtemp(join(tmpdir(),'mooz-invalid-env-'));try{const env=new RelaySettings(empty,{MOOZ_RELAY_URL:'bad',MOOZ_RELAY_KEY:'bad'});await env.init();assert.ok(env.snapshot().error);}finally{await rm(empty,{recursive:true,force:true});}}finally{await rm(dir,{recursive:true,force:true});}});
