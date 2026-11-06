const assert=require('node:assert/strict');
exports.checkRelaySettings=async page=>{
 const origin=new URL(page.url()).origin,key='ui-fixture-'+ 'q'.repeat(48);
 await page.goto(origin+'/#settings');
 const panel=page.getByRole('region',{name:'Kết nối Chrome máy ảo',exact:true});
 // section has an explicit accessible name and is exposed as a region.
 await panel.waitFor();const mode=panel.getByLabel('Phương thức kết nối Chrome',{exact:true});
 for(let i=0;i<100&&await mode.isDisabled();i++)await page.waitForTimeout(30);
 await mode.selectOption('relay');
 const endpoint=panel.getByLabel('Địa chỉ relay WSS',{exact:true}),password=panel.getByLabel('Khóa quản trị relay',{exact:true});
 await endpoint.fill('ws://relay.example.com/remote');await password.fill(key);await panel.getByRole('button',{name:'Lưu cấu hình',exact:true}).click();
 await panel.locator('.relay-status').filter({hasText:/wss:\/\//}).waitFor();
 await endpoint.fill('https://relay.example.com');await password.fill('short');await panel.getByRole('button',{name:'Kiểm tra relay',exact:true}).click();
 await panel.locator('.relay-status').filter({hasText:/32–256/}).waitFor();
 assert.equal(await page.evaluate(async()=>{const{api}=await import('./client-api.js');return(await api('chrome/config')).mode;}),'local','invalid test/save leaves prior config intact');
 await password.fill(key);await panel.getByRole('button',{name:'Lưu cấu hình',exact:true}).click();await panel.locator('.relay-status').filter({hasText:/Đã lưu cấu hình/}).waitFor();
 assert.equal(await password.inputValue(),'');assert.equal(await endpoint.inputValue(),'wss://relay.example.com/remote');
 const snapshot=await page.evaluate(async()=>{const{api}=await import('./client-api.js');return api('chrome/config');});assert.equal(snapshot.keyConfigured,true);assert.equal(JSON.stringify(snapshot).includes(key),false);assert.equal(Object.hasOwn(snapshot,'key'),false);
 await page.reload();await page.getByPlaceholder('Đã lưu khóa · để trống để giữ nguyên',{exact:true}).waitFor();
 assert.equal(await password.inputValue(),'');assert.equal(await mode.inputValue(),'relay');
 await mode.selectOption('local');await panel.getByRole('button',{name:'Lưu cấu hình',exact:true}).click();await panel.locator('.relay-status').filter({hasText:/Đã lưu cấu hình/}).waitFor();
 await panel.getByRole('button',{name:'Tạo mã ghép',exact:true}).click();await panel.getByLabel('Mã ghép Chrome máy ảo',{exact:true}).waitFor();
 const pairing=await panel.getByLabel('Mã ghép Chrome máy ảo',{exact:true}).inputValue();assert.match(pairing,/^workflow-connect:\/\/127\.0\.0\.1:/);
 assert.equal(await page.evaluate(()=>fetch('/api/chrome/config').then(response=>response.status)),403,'config cannot be read without the app request header');
 await panel.getByRole('button',{name:'Xóa cấu hình relay',exact:true}).click();await panel.locator('.relay-status').filter({hasText:/Đã xóa địa chỉ và khóa relay/}).waitFor();
 assert.equal((await page.evaluate(async()=>{const{api}=await import('./client-api.js');return api('chrome/config');})).keyConfigured,false);
 assert.equal(await panel.getByLabel('Mã ghép Chrome máy ảo',{exact:true}).isVisible(),false);
 return pairing;
};
exports.checkRelayBusyGuard=async page=>{
 const{WebSocket}=require('ws'),P=require('../vendor/mooz/chrome-remote-protocol.js');
 const pair=await page.evaluate(async()=>{const{api}=await import('./client-api.js');return api('chrome/pair',{});});const parsed=P.parseURI(pair.uri);
 const socket=new WebSocket('ws://127.0.0.1:'+parsed.port,{origin:'chrome-extension://'+'a'.repeat(32)});
 let pending,seen;const generated=new Promise(r=>seen=r),reply=(id,result)=>socket.send(JSON.stringify({type:'response',id,result}));
 try{
  await new Promise((resolve,reject)=>{socket.once('error',reject);socket.on('open',()=>socket.send(JSON.stringify({type:'auth',protocol:1,token:parsed.token,extensionVersion:'1.9.2'})));socket.on('message',bytes=>{const m=JSON.parse(bytes);if(m.type==='ready')resolve();if(m.type!=='request')return;if(m.operation==='tabs.get')reply(m.id,{id:19,url:'https://grok.com/chat/fixture'});else if(m.operation==='tabs.script')reply(m.id,[{result:true}]);else if(m.operation==='tabs.message'&&m.payload.message.type==='WORKFLOW_AI_CHECK')reply(m.id,{ok:true,composer:true,signedIn:true,sendProtocol:1});else if(m.operation==='tabs.message'){pending=m;seen();}});});
  await page.evaluate(async()=>{const{api}=await import('./client-api.js');window.relayGuardJob=api('jobs',{requestId:crypto.randomUUID(),provider:'grok',mediaType:'text',tabId:19,chatURL:'https://grok.com/chat/fixture',prompt:'Fixture held response'});});
  let timer;try{await Promise.race([generated,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Fixture generation did not start')),10000))]);}finally{clearTimeout(timer);}
  const errors=await page.evaluate(async()=>{const{api}=await import('./client-api.js');const out=[];for(const path of ['chrome/config','chrome/test-relay','chrome/disconnect'])try{await api(path,{mode:'relay',endpoint:'wss://relay.example.com/remote',key:'x'.repeat(40)});}catch(error){out.push(error.message);}return out;});
  assert.equal(errors.length,3);assert.ok(errors.every(error=>error.includes('Chờ các yêu cầu đang chạy')));
  assert.equal(await page.evaluate(async()=>{const{api}=await import('./client-api.js');return(await api('status')).chrome.connected;}),true);
  reply(pending.id,{ok:true,requestId:pending.payload.message.requestId,text:'Fixture complete'});
  assert.equal((await page.evaluate(()=>window.relayGuardJob)).status,'success');
  await page.evaluate(async()=>{const{api}=await import('./client-api.js');await api('chrome/disconnect',{});});
 }finally{socket.terminate();}
};
