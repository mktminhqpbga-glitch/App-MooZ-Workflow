const vm=require('node:vm'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {webcrypto}=require('node:crypto');
execFileSync('python3',['native/Tools/build_companion.py']);
const source=execFileSync('unzip',['-p','native/artifacts/MooZ-Connect-Native.zip','desktop/chrome-relay-worker.js'],{encoding:'utf8'});
const packets=[],sockets=[],local={},session={};
const storage=record=>({get:async()=>({...record}),set:async values=>Object.assign(record,values),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete record[key];}});
class Socket {
  static OPEN=1;
  constructor(url){this.url=url;this.readyState=0;this.bufferedAmount=0;sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen?.();});}
  send(text){const message=JSON.parse(text);packets.push(message);if(message.type==='auth')queueMicrotask(()=>this.receive({type:'ready',protocol:1,resultRecovery:1,appVersion:'fixture'}));}
  receive(value){this.onmessage?.({data:JSON.stringify(value)});}
  close(code=1000){this.readyState=3;this.onclose?.({code});}
}
const event={addListener:()=>{}};
const chrome={storage:{local:storage(local),session:storage(session)},runtime:{id:'fixture',getURL:()=> 'chrome-extension://fixture/',getManifest:()=>({version:'2.0.0'}),onMessage:event},
  tabs:{get:async id=>({id,url:'https://chatgpt.com/c/one',title:'fixture'}),query:async()=>[],sendMessage:async(id,message)=>({ok:true,accepted:true,type:message.type}),onUpdated:event,onRemoved:event,onCreated:event},
  scripting:{executeScript:async()=>[{result:null}]}};
const context={WebSocket:Socket,chrome,crypto:webcrypto,URL,TextEncoder,setTimeout,clearTimeout,setInterval,clearInterval,
  WorkflowAISites:{providerForURL:url=>url.startsWith('https://chatgpt.com/')?'chatgpt':null},
  WorkflowRemoteDiagnostics:{connectionReport:value=>({connection:value.transport||{}}),connectionFailure:()=>({code:'fixture',message:'fixture'})}};
vm.runInNewContext(source,context,{filename:'packaged-native-worker.js'});
(async()=>{
  try{
    await context.WorkflowChromeRelay.connect('workflow-connect://127.0.0.1:4175/'+'a'.repeat(64));
    const auth=packets.find(p=>p.type==='auth');
    assert.equal(auth.moozDeviceID,local.moozNativeDeviceID);assert.equal(auth.moozSessionID,session.moozNativeSessionID);
    assert.match(auth.moozDeviceID,/^[0-9a-f-]{36}$/);
    const socket=sockets[0];
    for(const type of ['WORKFLOW_AI_JOB_START','WORKFLOW_AI_JOB_STATUS','WORKFLOW_AI_JOB_ACK']){
      socket.receive({type:'request',id:type,operation:'tabs.message',payload:{id:17,message:{type,requestId:'r'}}});
      for(let i=0;i<20&&!packets.some(p=>p.id===type);i++)await new Promise(resolve=>setTimeout(resolve,5));
      const reply=packets.find(p=>p.id===type);assert.equal(reply?.error,undefined,reply?.error);assert.equal(reply?.result?.type,type);
      socket.receive({type:'response-ack',id:type});
    }
    socket.receive({type:'request',id:'script',operation:'tabs.script',payload:{id:17,files:['ai-bridge.js']}});
    for(let i=0;i<20&&!packets.some(p=>p.id==='script');i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.ok(Array.isArray(packets.find(p=>p.id==='script').result),'Native health must accept Chrome executeScript array response');
    console.log('PASS native worker fixture: persisted install/session identity, generic START/STATUS/ACK permitted, actual executeScript array contract. No browser account.');
  }finally{await context.WorkflowChromeRelay.disconnect();}
})().catch(error=>{console.error(error);process.exitCode=1;});
