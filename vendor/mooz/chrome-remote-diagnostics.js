/* Read-only remote reachability checks. Never send pairing/session credentials. */
(function(root){
 'use strict';
 const P=typeof module!=='undefined'?require('./chrome-remote-protocol.js'):root.WorkflowRemoteProtocol;
 const SERVICE='mooz-chrome-relay';
 async function check(endpoint,{fetchImpl=globalThis.fetch,expectedInstance,signal,timeoutMs=6000}={}){
  const url=new URL(P.endpoint(endpoint));url.protocol='https:';url.pathname+='/health';
  const nonce=globalThis.crypto.randomUUID().replace(/-/g,'');url.searchParams.set('probe',nonce);
  const result=(ok,code,message,status=null)=>({ok,code,message,status,checkedAt:Date.now()});
  try{
   const timeout=AbortSignal.timeout(timeoutMs);
   const response=await fetchImpl(url.href,{credentials:'omit',redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout});
   let text='',length=0;const reader=response.body?.getReader();
   try{if(reader)while(length<8192){const n=await reader.read();if(n.done)break;const part=n.value.subarray(0,8192-length);text+=new TextDecoder().decode(part);length+=part.length;}}finally{await reader?.cancel().catch(()=>{});}
   if(response.status===403||/your request was blocked/i.test(text))return result(false,'blocked','Máy này bị chặn truy cập đường Cloudflare. Cần quản trị mạng hoặc nhà cung cấp máy ảo kiểm tra quyền truy cập; tạo mã mới không xử lý được chặn mạng.',response.status);
   if(/(?:error\s*(?:code\s*)?[:=]?\s*|<[^>]*>)1033\b/i.test(text))return result(false,'tunnel_offline','Lỗi Cloudflare 1033: địa chỉ này không có tunnel đang kết nối. Đối chiếu địa chỉ hiện tại trong MooZ và kiểm tra cloudflared trên máy chạy app.',response.status);
   if([502,503,504].includes(response.status))return result(false,'origin_offline','Cloudflare chưa chuyển tiếp được tới bộ nối MooZ. Kiểm tra app, tunnel và cổng nội bộ trên máy chạy app.',response.status);
   if(response.status===426)return result(false,'legacy','Đã tới máy chủ WebSocket, nhưng chưa có kiểm tra danh tính đường truyền. Cập nhật MooZ 0.50.1 để chẩn đoán đầy đủ.',426);
   let body;try{body=JSON.parse(text);}catch{}
   if(response.status!==200||body?.service!==SERVICE||body.protocol!==1||body.probe!==nonce||!/^([a-f0-9]{8}-){1}[a-f0-9-]{27}$/.test(body.instance||''))return result(false,'wrong_service','Đường HTTPS chưa trả về bộ nối MooZ hợp lệ. Kiểm tra địa chỉ/cấu hình tunnel, trang đăng nhập hoặc lớp kiểm tra của mạng.',response.status);
   if(expectedInstance&&body.instance!==expectedInstance)return result(false,'wrong_instance','Tunnel đang tới một phiên MooZ khác. Chưa tạo mã; kiểm tra cổng đích và địa chỉ hiện tại trong app.',response.status);
   return result(true,'ready','Đã truy cập HTTPS và xác nhận bộ nối MooZ qua tunnel. Chrome vẫn cần kết nối WebSocket bằng mã ghép cặp.',200);
  }catch{
   return result(false,'unreachable','Máy này chưa truy cập được HTTPS của tunnel. Kiểm tra DNS, mạng, chứng chỉ và app đang mở; chưa thể kết luận riêng nguyên nhân từ lỗi này.');
  }
 }
 async function checkRelay(endpoint,{fetchImpl=globalThis.fetch,timeoutMs=8000}={}){
  const url=new URL(P.relayEndpoint(endpoint));url.protocol='https:';url.pathname='/health';
  const result=(ok,code,message,status=null)=>({ok,code,message,status,checkedAt:Date.now()});
  try{const r=await fetchImpl(url.href,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(timeoutMs)});const reader=r.body?.getReader();let text='',size=0;try{if(reader)while(size<8192){const part=await reader.read();if(part.done)break;const bytes=part.value.subarray(0,8192-size);text+=new TextDecoder().decode(bytes);size+=bytes.length;}}finally{await reader?.cancel().catch(()=>{});}if(r.status===403||/your request was blocked/i.test(text))return result(false,'blocked','Máy này bị từ chối truy cập máy chủ relay. Cần kiểm tra quyền truy cập với nhà cung cấp mạng/dịch vụ.',r.status);let body;try{body=JSON.parse(text);}catch{}if(r.status!==200||body?.service!=='mooz-outbound-relay'||body.relayProtocol!==1)return result(false,'wrong_service','Máy chủ relay chưa sẵn sàng hoặc không đúng bộ cài MooZ. Kiểm tra dịch vụ Live và địa chỉ Render; gói Free có thể cần khoảng một phút để mở lại.',r.status);return result(true,'ready','Đã tới máy chủ relay. App MooZ vẫn phải đăng nhập relay và ghép Chrome bằng mã.',200);}catch{return result(false,'unreachable','Chưa truy cập được máy chủ relay qua HTTPS. Kiểm tra mạng và dịch vụ đã Live; gói Free có thể đang khởi động.');}
 }
 function checkRelaySocket(endpoint,{WebSocketClass=root.WebSocket,timeoutMs=10000}={}){
  const address=P.relayEndpoint(endpoint);
  return new Promise(resolve=>{
   let socket,timer,finished=false;
   const finish=(ok,code)=>{if(finished)return;finished=true;clearTimeout(timer);resolve({ok,code,checkedAt:Date.now()});try{socket?.close(1000,'Diagnostic complete');}catch{}};
   timer=setTimeout(()=>finish(false,'websocket_timeout'),timeoutMs);
   try{socket=new WebSocketClass(address);socket.onopen=()=>finish(true,'websocket_ready');socket.onerror=()=>finish(false,'websocket_unreachable');socket.onclose=()=>finish(false,'websocket_closed');}
   catch{finish(false,'websocket_error');}
  });
 }
 async function checkRelayTransport(endpoint,options={}){
  const [https,websocket]=await Promise.all([checkRelay(endpoint,options),checkRelaySocket(endpoint,options)]);
  const ok=https.ok&&websocket.ok;
  return {ok,code:ok?'ready':!websocket.ok?'websocket_unreachable':https.code,checkedAt:Date.now(),https,websocket,
   message:ok?'Đã tới máy chủ relay qua HTTPS và mở được WebSocket. Hai bước này chưa xác nhận mã/phòng hoặc app MooZ; xem chẩn đoán lần ghép bên dưới.':https.ok?'HTTPS tới relay được, nhưng Chrome chưa mở được WebSocket. Kiểm tra Console của service worker, proxy/mạng và quyền truy cập WSS. Tạo mã mới không sửa được lỗi mở WebSocket.':websocket.ok?'WebSocket mở được nhưng kiểm tra HTTPS chưa đạt. '+https.message:https.message+' Chrome cũng chưa mở được WebSocket.'};
 }
 const STAGES=new Set(['opening_socket','joining_relay','authenticating_app','connected']);
 const FAILURES=new Set(['WSS_CONNECT_FAILED','RELAY_JOIN_REJECTED','APP_AUTH_REJECTED','RELAY_BUSY','RELAY_PROTOCOL_ERROR','CONNECT_TIMEOUT','TRANSPORT_CLOSED','SOCKET_CONSTRUCTION_FAILED']);
 function connectionFailure(transport={},kind='closed'){
  const stage=transport.stage,code=transport.closeCode;
  if(kind==='timeout')return {code:'CONNECT_TIMEOUT',message:stage==='opening_socket'?'Chờ quá lâu khi mở WebSocket tới máy chủ kết nối. Bấm Kiểm tra đường truyền để phân biệt HTTPS và WSS.':stage==='joining_relay'?'WebSocket đã mở nhưng chưa nhận xác nhận vào phòng relay. Kiểm tra relay và mã mới trong app.':'Đã mở đường kết nối nhưng chưa nhận xác nhận từ app MooZ. Giữ app mở và kiểm tra báo cáo kết nối trong app.'};
  if(code===1013)return {code:'RELAY_BUSY',message:'App hoặc phòng đang kết nối với một Chrome khác. Ngắt phiên cũ trong MooZ trước khi ghép.'};
  if(code===1008)return stage==='joining_relay'?{code:'RELAY_JOIN_REJECTED',message:'WebSocket đã mở nhưng phòng/mã ghép cặp bị relay từ chối hoặc đã hết hiệu lực. Giữ app mở, tạo và sao chép mã mới một lần rồi dán ngay; tạo mã khác sẽ thu hồi mã trước.'}:{code:'APP_AUTH_REJECTED',message:'Mã hoặc phiên đã hết hiệu lực tại app MooZ. Giữ app mở và tạo mã mới để ghép lại.'};
  if(stage==='opening_socket')return {code:'WSS_CONNECT_FAILED',message:'Không mở được WebSocket từ Chrome tới máy chủ kết nối. HTTPS 200 chưa xác nhận đường WSS. Bấm Kiểm tra đường truyền và sao chép chẩn đoán.'};
  if(code===4008)return {code:'RELAY_PROTOCOL_ERROR',message:'Đường relay đã mở nhưng giao thức hoặc kênh mã hóa chưa được xác nhận. Sao chép chẩn đoán; không tự gửi lại công việc AI.'};
  return {code:'TRANSPORT_CLOSED',message:'Kết nối đã ngắt sau bước '+(stage==='joining_relay'?'mở WebSocket':stage==='authenticating_app'?'vào phòng relay':'xác thực app')+'. Kiểm tra hai máy rồi kết nối lại; app không tự gửi lại yêu cầu AI.'};
 }
 function connectionReport(value={}){
  const t=value.transport||{},d=value.diagnostics||{},semver=v=>/^\d+\.\d+\.\d+$/.test(v||'')?v:null;
  let endpoint=null;try{endpoint=P.endpoint(value.endpoint);}catch{}
  const probe=p=>p?{ok:p.ok===true,status:Number.isInteger(p.status)?p.status:null,code:['ready','blocked','wrong_service','unreachable','websocket_ready','websocket_timeout','websocket_unreachable','websocket_closed','websocket_error'].includes(p.code)?p.code:null}:null;
  return {schema:1,capturedAt:new Date().toISOString(),extensionVersion:semver(value.extensionVersion),appVersion:semver(value.appVersion),mode:['local','remote','relay'].includes(value.mode)?value.mode:null,connected:value.connected===true,endpoint,
   connection:{stage:STAGES.has(t.stage)?t.stage:null,socketOpened:t.socketOpened===true,roomJoined:t.roomJoined===true,appAuthenticated:t.appAuthenticated===true,closeCode:Number.isInteger(t.closeCode)&&t.closeCode>=1000&&t.closeCode<=4999?t.closeCode:null,failure:FAILURES.has(t.failure)?t.failure:null,elapsedMs:Number.isFinite(t.elapsedMs)?Math.max(0,Math.min(900000,t.elapsedMs)):null},checks:{https:probe(d.https||(d.code?d:null)),websocket:probe(d.websocket)}};
 }
 const api={check,checkRelay,checkRelaySocket,checkRelayTransport,connectionFailure,connectionReport,SERVICE};if(typeof module!=='undefined')module.exports=api;else root.WorkflowRemoteDiagnostics=api;
})(globalThis);
