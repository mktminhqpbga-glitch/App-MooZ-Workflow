import {mkdir, readFile, writeFile, rename, chmod} from 'node:fs/promises';
import {join} from 'node:path';
import protocol from '../vendor/mooz/chrome-remote-protocol.js';
const validKey = key => typeof key==='string' && key.length>=32 && key.length<=256 && !/[\s\x00-\x1f]/.test(key);
export class RelaySettings {
  constructor(directory, env={}) { this.directory=directory;this.file=join(directory,'chrome-connection.json');this.env=env;this.current={mode:'local',endpoint:'',key:''}; }
  async init() {
    try {
      const saved=JSON.parse(await readFile(this.file,'utf8'));
      this.current=this.resolve(saved,{mode:'local',endpoint:'',key:''});
      await chmod(this.file,0o600);
    } catch(error) {
      if(error.code!=='ENOENT')this.loadError='Không đọc được cấu hình Chrome đã lưu. Chọn phương thức và lưu lại hoặc xóa cấu hình relay.';
      else if(this.env.MOOZ_RELAY_URL)try{this.current=this.resolve({mode:'relay',endpoint:this.env.MOOZ_RELAY_URL,key:this.env.MOOZ_RELAY_KEY||''});}catch{this.loadError='Cấu hình relay trong môi trường chưa hợp lệ. Nhập và lưu lại trong Cài đặt.';}
    }
  }
  snapshot() {const {mode,endpoint,key}=this.current;return {mode,endpoint,keyConfigured:!!key,...(this.loadError?{error:this.loadError}:{})};}
  resolve(input,previous=this.current) {
    if(!input||!['local','relay'].includes(input.mode))throw Error('Chọn Chrome cùng máy hoặc relay máy ảo.');
    if(input.clear===true)return {mode:'local',endpoint:'',key:''};
    const endpoint=String(input.endpoint??previous.endpoint).trim();
    const normalized=endpoint?protocol.relayAddress(endpoint):'';
    const supplied=input.key??'';
    if(typeof supplied!=='string')throw Error('Khóa relay không hợp lệ.');
    if(normalized!==previous.endpoint&&!supplied&&previous.key)throw Error('Nhập khóa cho địa chỉ relay mới.');
    const key=supplied||previous.key;
    if(key&&!validKey(key))throw Error('Khóa quản trị relay cần 32–256 ký tự, không có khoảng trắng.');
    if(input.mode==='relay'&&(!normalized||!key))throw Error('Nhập địa chỉ relay và khóa quản trị trước.');
    return {mode:input.mode,endpoint:normalized,key};
  }
  async save(next) {
    await mkdir(this.directory,{recursive:true});
    await writeFile(this.file+'.tmp',JSON.stringify(next),{mode:0o600});
    await chmod(this.file+'.tmp',0o600);await rename(this.file+'.tmp',this.file);
    this.current=next;this.loadError=null;return this.snapshot();
  }
}
