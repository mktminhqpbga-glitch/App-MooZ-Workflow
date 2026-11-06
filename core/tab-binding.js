export function parseTabBinding(value){
 if(!value)return null;
 let binding;try{binding=typeof value==='string'?JSON.parse(value):value;}catch{throw Error('Lựa chọn tab đã lưu không hợp lệ.');}
 if(!binding||!Number.isSafeInteger(binding.id)||binding.id<1||!['muse','gemini','chatgpt','grok','flow'].includes(binding.provider)||typeof binding.title!=='string'||binding.title.length>300||typeof binding.url!=='string'||binding.url.length>4000)throw Error('Lựa chọn tab đã lưu không hợp lệ.');
 const url=new URL(binding.url);if(url.protocol!=='https:')throw Error('Tab AI cần URL HTTPS.');
 return {id:binding.id,url:binding.url,title:binding.title,provider:binding.provider};
}
