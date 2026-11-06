import{emptyGraph,validateGraph}from'./graph.js';
export const recipeSteps=Object.freeze({readProduct:'Đọc ảnh sản phẩm',script:'Viết kịch bản',image:'Tạo ảnh từng cảnh',video:'Tạo video',assemble:'Ghép thành phẩm',store:'Đưa vào Kho',post:'Hậu kỳ'});
export function defaultRecipe(kind='video'){return{version:1,kind,name:kind==='video'?'Ảnh sản phẩm → Video thành phẩm':'Ảnh sản phẩm → Ảnh mới',provider:'',globalPrompt:'',size:'16:9',scenes:1,duration:null,steps:(kind==='video'?['readProduct','script','video','assemble','store']:['readProduct','image']).map(type=>({id:crypto.randomUUID(),type,prompt:({readProduct:'Đọc ảnh sản phẩm, mô tả đúng đặc điểm nhìn thấy. Không bịa thông tin không có trong ảnh.',script:'Viết kịch bản theo thông tin sản phẩm và yêu cầu. Giữ đúng nhận diện, nhãn và các đặc điểm sản phẩm.',image:'Tạo ảnh theo yêu cầu, giữ đúng sản phẩm tham chiếu.',video:'Tạo video theo kịch bản của đúng cảnh, giữ đúng sản phẩm và nhân vật tham chiếu.'})[type]||'',settings:{}}))};}
export function validateRecipe(value){
 if(!value||value.version!==1||!['image','video'].includes(value.kind)||typeof value.name!=='string'||!value.name.trim()||value.name.length>100||!Array.isArray(value.steps)||!value.steps.length||value.steps.length>12)throw Error('Thiết lập luồng không hợp lệ.');
 if(!Number.isInteger(value.scenes)||value.scenes<1||value.scenes>12)throw Error('Chọn 1–12 cảnh.');
 if(!/^\d{1,2}:\d{1,2}$/.test(value.size)||value.duration!==null&&(!Number.isInteger(value.duration)||value.duration<1||value.duration>120))throw Error('Tỷ lệ hoặc thời lượng không hợp lệ.');
 if(value.globalPrompt!=null&&(typeof value.globalPrompt!=='string'||value.globalPrompt.length>20000))throw Error('Prompt chung tối đa 20.000 ký tự.');
 const known=new Set(),ids=new Set();for(const step of value.steps){if(!recipeSteps[step.type]||typeof step.id!=='string'||ids.has(step.id)||typeof step.prompt!=='string'||step.prompt.length>20000||!step.settings||typeof step.settings!=='object'||Array.isArray(step.settings))throw Error('Bước trong luồng không hợp lệ.');if(known.has(step.type)&&step.type!=='post')throw Error('Mỗi loại bước chỉ dùng một lần, trừ hậu kỳ.');ids.add(step.id);known.add(step.type);}
 const index=type=>value.steps.findIndex(s=>s.type===type),has=type=>index(type)>=0;
 if(value.kind==='video'&&!has('video')||value.kind==='image'&&!has('image'))throw Error('Luồng cần bước tạo '+(value.kind==='video'?'video':'ảnh')+'.');
 if(value.scenes>1&&!has('script'))throw Error('Nhiều cảnh cần bước viết kịch bản.');
 for(const[a,b]of [['readProduct','script'],['readProduct','image'],['readProduct','video'],['script','image'],['script','video'],['image','video'],['video','assemble'],['assemble','store'],['video','store'],['video','post'],['assemble','post'],['store','post']])if(has(a)&&has(b)&&index(a)>index(b))throw Error(recipeSteps[a]+' phải trước '+recipeSteps[b]+'.');
 if(value.kind==='image'&&value.steps.some(s=>['video','assemble','store','post'].includes(s.type)))throw Error('Bước video/hậu kỳ cần luồng video.');
 if(value.scenes>1&&value.kind==='video'&&!has('assemble'))throw Error('Nhiều cảnh cần bước ghép thành phẩm.');
 for(const step of value.steps.filter(s=>s.type==='post'))if(!['videoTrim','videoColor','videoRotate','audioMix','subtitles','speed','frameFit','watermark'].includes(step.operation))throw Error('Chọn công cụ hậu kỳ được hỗ trợ.');
 return structuredClone(value);
}
export function compileRecipe(input,{prompt='',references=[],negative='',generation={},size,duration}={}){
 const recipe=validateRecipe(input),graph=emptyGraph(),refs=[],common={size:size||recipe.size,duration:duration===undefined?recipe.duration:duration,quality:'medium',resolution:recipe.kind==='video'?'720P':'1K',...generation,negativePrompt:negative};
 const add=(type,name,data={})=>{const node={id:crypto.randomUUID(),type,x:420*Math.floor(graph.nodes.length/4),y:260*(graph.nodes.length%4),data:{customName:name,...data}};graph.nodes.push(node);return node;},edge=(a,b,out,port)=>graph.edges.push({id:crypto.randomUUID(),source:a.id,target:b.id,sourcePort:out,targetPort:port});
 for(const ref of references)refs.push(add('imageInput',(ref.role==='character'?'Nhân vật · ':'Sản phẩm · ')+ref.name,{assetId:ref.id}));
 const task=add('prompt','Yêu cầu sản phẩm',{text:prompt});let description=null,script=null,images=[],videos=[],current=null;
 const withRefs=node=>{node.data.referenceRoles=JSON.stringify(Object.fromEntries(references.map(r=>[r.id,r.role||'product'])));for(const ref of refs)edge(ref,node,'image','reference');};
 for(const step of recipe.steps){const instruction=[recipe.globalPrompt,step.prompt].filter(Boolean).join('\n');
  if(step.type==='readProduct'){description=add('generateText',recipeSteps[step.type],{studioPrompt:instruction});edge(task,description,'text','prompt');withRefs(description);}
  if(step.type==='script'){script=add('generateText',recipeSteps[step.type],{studioPrompt:instruction,sceneCount:recipe.scenes});edge(description||task,script,'text','prompt');withRefs(script);}
  if(step.type==='image')for(let i=1;i<=recipe.scenes;i++){const n=add('generateImage','Ảnh cảnh '+i,{...common,resolution:['1K','2K','4K'].includes(common.resolution)?common.resolution:'1K',studioPrompt:instruction,...(script?{sceneIndex:i}:{})});edge(script||description||task,n,'text','prompt');withRefs(n);images.push(n);current=n;}
  if(step.type==='video')for(let i=1;i<=recipe.scenes;i++){const n=add('generateVideo','Video cảnh '+i,{...common,studioPrompt:instruction,...(script?{sceneIndex:i}:{})});edge(script||description||task,n,'text','prompt');if(images[i-1])edge(images[i-1],n,'image','reference');else withRefs(n);videos.push(n);current=n;}
  if(step.type==='assemble'){if(!videos.length)throw Error('Ghép cần clip trước.');current=add('assembleVideo','Ghép thành phẩm');for(const v of videos)edge(v,current,'video','videos');}
  if(step.type==='store'){if(!current||recipe.kind!=='video')throw Error('Kho cần video trước.');const n=add('storeVideo','Đưa video vào Kho');edge(current,n,'video','video');current=n;}
  if(step.type==='post'){if(!current)throw Error('Hậu kỳ cần video trước.');const n=add(step.operation,recipeSteps.post+' · '+step.operation,{localSettings:JSON.stringify(step.settings),captions:step.captions||''});edge(current,n,'video','video');if(step.assetId){const kind=step.operation==='watermark'?'image':'audio',a=add(kind+'Input','Đầu vào hậu kỳ',{assetId:step.assetId});edge(a,n,kind,kind==='image'?'reference':'audio');}current=n;}
 }
 if(graph.nodes.length>40||graph.edges.length>120)throw Error('Luồng vượt 40 bước / 120 dây. Giảm số cảnh/tham chiếu.');return validateGraph(graph);
}
