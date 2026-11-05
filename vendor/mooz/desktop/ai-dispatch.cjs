'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,timingSafeEqual}=require('node:crypto');
const GENERATE=new Set(['WORKFLOW_AI_GENERATE','MUSEFLOW_GENERATE','MUSEFLOW_JOB_START']);
const BLOCKS=new Set(['AI_DISCONNECTED','AI_VERIFICATION','AI_RATE_LIMIT']);
const DEFAULTS=Object.freeze({intervalMs:5000,cooldownMs:5000,maxActive:1});
class AIDispatch {
 constructor(directory,{notify=()=>{},now=()=>Date.now()}={}){this.file=path.join(directory,'ai-dispatch.json');this.notify=notify;this.now=now;this.config={...DEFAULTS};this.holds={};this.records=new Map();this.lastSent=new Map();this.lastFinished=new Map();this.history=[];this.writes=Promise.resolve();this.warning='';this.corrupt=false;this.sequence=0;}
 validate(c){if(!c||!Number.isInteger(c.intervalMs)||c.intervalMs<5000||c.intervalMs>120000||!Number.isInteger(c.cooldownMs)||c.cooldownMs<1000||c.cooldownMs>120000||!Number.isInteger(c.maxActive)||c.maxActive<1||c.maxActive>4)throw Error('Nhịp gửi 5–120 giây, nghỉ sau kết quả 1–120 giây; đồng thời 1–4 tác vụ mỗi nhà cung cấp.');return {intervalMs:c.intervalMs,cooldownMs:c.cooldownMs,maxActive:c.maxActive};}
 async init(){try{const v=JSON.parse(await fs.readFile(this.file,'utf8'));if(v.version!==1||!v.holds||typeof v.holds!=='object'||Array.isArray(v.holds))throw Error('schema');this.config=this.validate(v.config);for(const [key,h]of Object.entries(v.holds)){if(!/^[a-zA-Z0-9:./_-]{1,400}$/.test(key)||!BLOCKS.has(h.code)||typeof h.message!=='string'||h.message.length>500||!Number.isFinite(h.at)||h.until!==undefined&&!Number.isFinite(h.until))throw Error('hold');}this.holds=v.holds;}catch(e){if(e.code!=='ENOENT'){this.corrupt=true;this.warning='Không đọc được cài đặt nhịp AI. Lưu lại cài đặt để sao lưu tệp lỗi; chưa cấp phép gửi.';}}return this.snapshot();}
 snapshot(){return {config:{...this.config},holds:structuredClone(this.holds),warning:this.warning,active:[...this.records.values()].filter(r=>['preparing','sent'].includes(r.stage)).map(r=>({provider:r.provider,requestId:r.id,stage:r.stage})),waiting:[...this.records.values()].filter(r=>r.stage==='registered').length,history:this.history.slice(-40)};}
 event(type,r,extra={}){this.history.push({type,at:this.now(),provider:r.provider,requestId:r.id,...extra});this.history=this.history.slice(-100);this.changed();}
 changed(){try{this.notify({type:'aiDispatch'});}catch{}}
 async persist(){const task=this.writes.catch(()=>{}).then(async()=>{await fs.mkdir(path.dirname(this.file),{recursive:true});if(this.corrupt){await fs.copyFile(this.file,this.file+'.invalid-'+randomUUID());this.corrupt=false;}const tmp=this.file+'.tmp';await fs.writeFile(tmp,JSON.stringify({version:1,config:this.config,holds:this.holds}),{mode:0o600});await fs.rename(tmp,this.file);this.warning='';});this.writes=task;return task;}
 async configure(c){const old=this.config;this.config=this.validate(c);try{await this.persist();}catch(e){this.config=old;throw e;}this.changed();return this.snapshot();}
 holdError(provider){if(this.warning)return this.warning;const h=this.holds[provider];if(!h||h.until&&h.until<=this.now())return '';return h.message+(h.until?' Chờ đến hết thời hạn rồi kiểm tra lại.':' Mở trang AI, xử lý theo hướng dẫn dịch vụ rồi bấm Kiểm tra và tiếp tục trong cài đặt.');}
 async block(provider,block){if(!BLOCKS.has(block?.code))throw Error('Trạng thái AI không hợp lệ.');const h={code:block.code,message:String(block.message||'Dịch vụ AI yêu cầu kiểm tra.').slice(0,500),at:this.now(),...(Number.isFinite(block.until)?{until:block.until}:{})};this.holds[provider]=h;this.changed();try{await this.persist();}catch{this.warning='Chưa lưu được trạng thái tạm dừng AI; phiên hiện tại vẫn ngừng cấp việc.';this.changed();}}
 async resume(provider){if(!Object.hasOwn(this.holds,provider))return this.snapshot();const previous=this.holds[provider];delete this.holds[provider];try{await this.persist();}catch(error){this.holds[provider]=previous;throw error;}this.changed();return this.snapshot();}
 register(key,provider,id){if(this.holdError(provider))throw Error(this.holdError(provider));if(typeof id!=='string'||!id||id.length>160)throw Error('Thiếu mã tác vụ AI hợp lệ.');const mapKey=key+':'+id,prior=this.records.get(mapKey);if(prior){if(prior.stage==='done')throw Error('Mã lượt AI đã kết thúc; không gửi lại. Kiểm tra kết quả cũ trước.');return prior;}if([...this.records.values()].filter(r=>r.stage!=='done').length>=128)throw Error('Quá nhiều tác vụ AI đang chờ.');const r={key,provider,id,token:randomUUID(),stage:'registered',sequence:++this.sequence,createdAt:this.now(),expiresAt:0};this.records.set(mapKey,r);for(const [k,v]of this.records)if(this.records.size>500&&v.stage==='done')this.records.delete(k);this.event('queued',r);return r;}
 find(key,id){return this.records.get(key+':'+id);}
 finish(key,id){const r=this.find(key,id);if(!r||r.stage==='done')return;if(['preparing','sent'].includes(r.stage))this.lastFinished.set(r.provider,this.now());r.stage='done';this.event('finished',r);}
 async gate(key,m){if(!m||typeof m!=='object')return {ok:false,error:'Yêu cầu quyền gửi không hợp lệ.'};const r=this.find(key,m.requestId);if(!r||typeof m.token!=='string'||!/^[a-f0-9-]{36}$/.test(m.token)||m.token.length!==r.token.length||!timingSafeEqual(Buffer.from(m.token),Buffer.from(r.token)))return {ok:false,error:'Quyền gửi AI không hợp lệ.'};
  if(m.operation==='cancel'){this.finish(key,r.id);return {ok:true};}
  if(m.operation==='block'){await this.block(r.provider,m.block);return {ok:false,error:this.holdError(r.provider),code:m.block.code};}
  const error=this.holdError(r.provider);if(error)return {ok:false,error,code:this.holds[r.provider]?.code||'AI_PAUSED'};
  if(r.stage==='done')return {ok:false,error:'Tác vụ đã kết thúc; không gửi lại.'};
  if(m.operation==='prepare'){
   if(r.stage!=='registered')return {ok:true};
   const peers=[...this.records.values()].filter(x=>x.provider===r.provider),first=peers.filter(x=>x.stage==='registered'&&x.waitingPrepare).sort((a,b)=>a.sequence-b.sequence)[0];r.waitingPrepare=true;
   if((this.lastFinished.get(r.provider)??-Infinity)+this.config.cooldownMs>this.now()||peers.filter(x=>['preparing','sent'].includes(x.stage)).length>=this.config.maxActive||first&&first!==r)return {ok:true,waiting:true,waitMs:1000};
   r.stage='preparing';this.event('preparing',r);return {ok:true};
  }
  if(m.operation==='sent'){if(r.stage==='sent')return {ok:true};if(r.stage!=='preparing'||!r.expiresAt)return {ok:false,error:'Chưa cấp quyền gửi.'};r.stage='sent';this.lastSent.set(r.provider,Math.max(this.now(),...[...this.records.values()].filter(x=>x.provider===r.provider&&x.stage==='preparing').map(x=>x.expiresAt)));this.event('sent',r);return {ok:true};}
  if(m.operation!=='permit'||r.stage!=='preparing')return {ok:false,error:'Thứ tự gửi AI không hợp lệ.'};
  if(r.expiresAt>this.now())return {ok:true,expiresAt:r.expiresAt};
  const due=Math.max((this.lastSent.get(r.provider)??-Infinity)+this.config.intervalMs,(this.lastFinished.get(r.provider)??-Infinity)+this.config.cooldownMs),remaining=due-this.now();
  if(remaining>0)return {ok:true,waiting:true,waitMs:Math.min(1000,remaining)};
  r.expiresAt=this.now()+2000;this.lastSent.set(r.provider,r.expiresAt);this.event('permit',r);return {ok:true,expiresAt:r.expiresAt};
 }
 async disconnect(key){for(const r of this.records.values())if(r.key===key&&r.stage!=='done'){if(r.stage==='sent'&&!this.holdError(r.provider))await this.block(r.provider,{code:'AI_DISCONNECTED',message:'Tab/kết nối AI bị ngắt sau khi đã gửi. Kiểm tra kết quả cũ trước khi tiếp tục; app không tự gửi lại.'});this.finish(key,r.id);}}
 async invoke(key,provider,message,send){
  const type=message.type;
  if(GENERATE.has(type)){
   const prior=this.find(key,message.requestId);if(prior&&prior.stage!=='done'&&type==='MUSEFLOW_JOB_START')return send({...message,dispatchProtocol:1,dispatchToken:prior.token});
   const error=this.holdError(provider);if(error)throw Error(error);
   const check=await send({type:provider==='muse'?'MUSEFLOW_CHECK_SESSION':'WORKFLOW_AI_CHECK'});
   if(check?.block){await this.block(provider,check.block);throw Error(this.holdError(provider));}
   if(check?.sendProtocol!==1)throw Error('Cập nhật Workflow Connect 1.1.0 trở lên và tải lại tab AI để bật điều phối gửi an toàn.');
   const r=this.register(key,provider,message.requestId);
   try{const result=await send({...message,dispatchProtocol:1,dispatchToken:r.token});if(type!=='MUSEFLOW_JOB_START'||result?.ok===false)this.finish(key,r.id);if(result?.block)await this.block(provider,result.block);return result;}catch(e){if((r.stage==='sent'||r.expiresAt>0)&&!this.holdError(provider))await this.block(provider,{code:'AI_DISCONNECTED',message:'Mất phản hồi sau khi gửi AI; kết quả chưa rõ. Kiểm tra tab trước khi tiếp tục, không tự gửi lại.'});this.finish(key,r.id);throw e;}
  }
  const result=await send(message);
  if(type==='MUSEFLOW_JOB_STATUS'&&result?.result?.block)await this.block(provider,result.result.block);
  if(type==='MUSEFLOW_JOB_STATUS'&&(result?.state==='done'||result?.state==='missing')){if(result?.state==='missing')await this.disconnect(key);this.finish(key,message.requestId);}
  if(type==='MUSEFLOW_STOP_GENERATION'||type==='WORKFLOW_AI_STOP')this.finish(key,message.requestId);
  if(type==='MUSEFLOW_CHECK_SESSION'||type==='WORKFLOW_AI_CHECK'){
   if(result?.block)await this.block(provider,result.block);
   if(result?.sendProtocol!==1&&!result?.block)return {...result,ok:false,composer:false,sendUpgrade:true,error:'Cập nhật Workflow Connect 1.1.0 trở lên rồi tải lại tab AI trước khi gửi.'};
   const error=this.holdError(provider);if(error)return {...result,ok:false,composer:false,blocked:true,error};
  }
  return result;
 }
 async api(provider,signal,fn){const id='api-'+randomUUID(),r=this.register(provider,provider,id),request={requestId:id,token:r.token};const wait=async operation=>{while(true){signal?.throwIfAborted();const v=await this.gate(provider,{...request,operation});if(!v.ok)throw Error(v.error);if(!v.waiting)return;await new Promise((resolve,reject)=>{const stop=()=>{clearTimeout(timer);reject(new DOMException('Đã dừng.','AbortError'));},timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},v.waitMs);signal?.addEventListener('abort',stop,{once:true});});}};try{await wait('prepare');await wait('permit');await this.gate(provider,{...request,operation:'sent'});return await fn();}finally{this.finish(provider,id);}}
 async rateLimit(provider,header){const seconds=Number(header),date=Date.parse(header),delay=header&&Number.isFinite(seconds)?Math.max(1,seconds)*1000:Number.isFinite(date)?Math.max(1000,date-this.now()):60000;await this.block(provider,{code:'AI_RATE_LIMIT',message:'API trả HTTP 429; đang chờ theo hạn mức dịch vụ, không tự gửi lại yêu cầu cũ.',until:this.now()+Math.min(86400000,delay)});}
}
module.exports={AIDispatch,DEFAULTS};
