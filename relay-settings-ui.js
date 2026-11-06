import {api,el,notice} from './client-api.js';
export function mountRelaySettings(host,{onChanged=()=>{}}={}) {
  const panel=el('section',undefined,'settings-panel relay-settings');
  panel.setAttribute('aria-label','Kết nối Chrome máy ảo');
  panel.append(el('h2','Kết nối Chrome máy ảo'),el('p','Chọn local nếu Chrome cùng máy với app. Chrome trong máy ảo hoặc máy khác cần một dịch vụ relay MooZ hỗ trợ WSS.'));
  const mode=el('select'),endpoint=el('input'),key=el('input'),remote=el('div',undefined,'relay-fields'),status=el('p','Đang đọc cấu hình…','relay-status'),saved=el('small'),actions=el('div',undefined,'relay-actions'),code=el('textarea');
  mode.setAttribute('aria-label','Phương thức kết nối Chrome');
  mode.add(new Option('Chrome cùng máy · local','local'));mode.add(new Option('Chrome máy ảo / máy khác · relay WSS','relay'));
  endpoint.type='url';endpoint.placeholder='wss://relay.example.com/remote';endpoint.setAttribute('aria-label','Địa chỉ relay WSS');endpoint.spellcheck=false;
  key.type='password';key.autocomplete='new-password';key.setAttribute('aria-label','Khóa quản trị relay');key.maxLength=256;
  const label=(text,control)=>{const wrap=el('label');wrap.append(el('span',text),control);return wrap;};
  remote.append(label('Địa chỉ relay WSS',endpoint),label('Khóa quản trị relay',key),saved,el('p','Dùng địa chỉ dịch vụ relay MooZ đã triển khai, không phải địa chỉ website AI. Có thể dán URL HTTPS của dịch vụ; app chuyển sang WSS /remote. Khóa được lưu cục bộ phía máy chủ, không trả lại cho giao diện.'));
  panel.append(label('Phương thức kết nối Chrome',mode),remote,el('p','Đổi hoặc xóa cấu hình sẽ ngắt phiên Chrome hiện tại. Chờ các yêu cầu đang chạy kết thúc, sau đó tạo mã và ghép lại.'),actions,status);
  let alive=true,loaded=false,busy=false,current={mode:'local',endpoint:'',keyConfigured:false};
  const control=(name,fn)=>{const b=el('button',name);b.type='button';b.onclick=()=>run(fn);actions.append(b);return b;};
  const payload=()=>({mode:mode.value,endpoint:endpoint.value.trim(),key:key.value});
  const dirty=()=>mode.value!==current.mode||endpoint.value.trim()!==current.endpoint||!!key.value;
  const save=control('Lưu cấu hình',async()=>{
    const result=await api('chrome/config',payload());if(!alive)return;
    apply(result);clearCode();status.textContent=result.disconnected?'Đã lưu cấu hình và ngắt phiên Chrome cũ. Tạo mã ghép mới để kết nối.':'Đã lưu cấu hình.';await onChanged();
  });
  const test=control('Kiểm tra relay',async()=>{
    status.textContent='Đang kiểm tra HTTPS/WSS và xác thực khóa relay… Có thể mất tới 90 giây khi dịch vụ đang khởi động.';
    const result=await api('chrome/test-relay',payload());if(alive)status.textContent=result.message+(dirty()?' Lưu cấu hình trước khi tạo mã ghép.':'');
  });
  const pair=control('Tạo mã ghép',async()=>{
    const result=await api('chrome/pair',{});if(!alive)return;
    code.value=result.uri;code.hidden=false;copy.hidden=false;
    status.textContent=result.mode==='remote'?'Mã ghép máy ảo đã tạo. Dán vào MooZ Connect trong Chrome máy ảo. Mã có hạn; không chia sẻ công khai.':'Mã local đã tạo. Dán vào MooZ Connect trong Chrome cùng máy với app.';await onChanged();
  });
  const clear=control('Xóa cấu hình relay',async()=>{
    const result=await api('chrome/config',{mode:'local',clear:true});if(!alive)return;
    apply(result);clearCode();status.textContent='Đã xóa địa chỉ và khóa relay; chuyển về Chrome cùng máy.';await onChanged();
  });
  const copy=control('Sao chép mã ghép',async()=>{await navigator.clipboard.writeText(code.value);notice('Đã sao chép mã ghép.');});copy.hidden=true;
  code.readOnly=true;code.hidden=true;code.setAttribute('aria-label','Mã ghép Chrome máy ảo');panel.append(code);host.append(panel);
  function clearCode(){code.value='';code.hidden=true;copy.hidden=true;}
  function sync(){remote.hidden=mode.value!=='relay';mode.disabled=endpoint.disabled=key.disabled=busy||!loaded;
    save.disabled=busy||!loaded||!dirty()&&!current.error;test.disabled=busy||!loaded||mode.value!=='relay';pair.disabled=busy||!loaded||dirty()||!!current.error;clear.disabled=busy||!loaded||!current.endpoint&&!current.keyConfigured&&!current.error;copy.disabled=busy||!code.value;
  }
  function apply(result){current=result;loaded=true;mode.value=result.mode;endpoint.value=result.endpoint;key.value='';key.placeholder=result.keyConfigured?'Đã lưu khóa · để trống để giữ nguyên':'Nhập khóa quản trị relay';saved.textContent=result.keyConfigured?'Đã có khóa lưu trên máy chủ.':'Chưa lưu khóa relay.';sync();}
  async function run(fn){if(busy||!loaded)return;busy=true;sync();try{await fn();}catch(error){if(alive)status.textContent=error.message;}finally{busy=false;if(alive)sync();}}
  for(const field of [mode,endpoint,key])field.addEventListener(field===mode?'change':'input',()=>{clearCode();status.textContent=dirty()?'Chưa lưu thay đổi. Lưu cấu hình trước khi tạo mã ghép.':'Cấu hình đang dùng đã lưu.';sync();});
  sync();void api('chrome/config').then(result=>{if(alive){apply(result);status.textContent=result.error|| (result.mode==='relay'?'Đã lưu chế độ relay. Kiểm tra relay, rồi tạo mã ghép cho Chrome máy ảo.':'Đang dùng Chrome cùng máy. Chọn relay nếu Chrome nằm trong máy ảo.');}}).catch(error=>{if(alive)status.textContent=error.message;});
  return ()=>{alive=false;key.value='';clearCode();};
}
