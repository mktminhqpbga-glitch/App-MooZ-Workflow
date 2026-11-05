/* CVN adaptation: output adapter renamed; original local editing behavior retained. */
/* Local image tools. Applying creates a derived canvas asset; the source is never overwritten. */
(function(root){
 'use strict';
 const MAX_SIDE=8192,MAX_PIXELS=32*1024*1024,MAX_BYTES=20*1024*1024;
 const integer=(n,fallback)=>Number.isFinite(Number(n))?Math.round(Number(n)):fallback;
 function cropBounds(width,height,crop={}){
  const w=Math.max(1,Math.min(width,integer(crop.width,width))),h=Math.max(1,Math.min(height,integer(crop.height,height)));
  return {x:Math.max(0,Math.min(width-w,integer(crop.x,0))),y:Math.max(0,Math.min(height-h,integer(crop.y,0))),width:w,height:h};
 }
 function ratioCrop(width,height,ratio){
  if(!Number.isFinite(ratio)||ratio<=0)return cropBounds(width,height);
  const w=Math.min(width,height*ratio),h=w/ratio;
  return cropBounds(width,height,{x:(width-w)/2,y:(height-h)/2,width:w,height:h});
 }
 function outputSize(crop,rotation=0,resizeWidth=0){
  const quarter=Math.abs(rotation%180)===90,baseWidth=quarter?crop.height:crop.width,baseHeight=quarter?crop.width:crop.height;
  const width=integer(resizeWidth,0)||baseWidth,height=Math.max(1,Math.round(width*baseHeight/baseWidth));
  if(width<1||width>MAX_SIDE||height>MAX_SIDE||width*height>MAX_PIXELS)throw Error('Ảnh xuất tối đa 8.192 px mỗi chiều và 32 megapixel. Chọn kích thước nhỏ hơn.');
  return {width,height};
 }
 function defaults(width,height){return {crop:cropBounds(width,height),ratio:'free',rotation:0,flipX:false,flipY:false,brightness:100,contrast:100,saturation:100,resizeWidth:0};}
 const api={cropBounds,ratioCrop,outputSize};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root.document||root.MooZImageEditor)return;
 const dialog=document.createElement('dialog');dialog.id='canvasImageEditor';dialog.className='canvas-image-editor';dialog.setAttribute('aria-labelledby','canvasImageEditorTitle');
 dialog.innerHTML=`<form id="canvasImageEditorForm">
  <header class="image-editor-header"><div><h2 id="canvasImageEditorTitle">Chỉnh sửa ảnh</h2><p id="imageEditorSourceName"></p></div><button id="imageEditorClose" type="button" aria-label="Đóng chỉnh sửa ảnh">Đóng</button></header>
  <div class="image-editor-workspace"><section class="image-editor-stage" aria-label="Xem trước ảnh đã chỉnh"><div class="image-editor-preview"><canvas id="imageEditorPreview"></canvas></div><p id="imageEditorDimensions" role="status"></p></section>
   <div class="image-editor-controls">
    <label for="imageEditorName">Tên ảnh mới<input id="imageEditorName" maxlength="120" required></label>
    <fieldset><legend>Cắt ảnh</legend><label for="imageEditorRatio">Tỷ lệ<select id="imageEditorRatio"><option value="free">Tự do</option><option value="1">1:1</option><option value="1.7777777777777777">16:9</option><option value="0.5625">9:16</option><option value="0.75">3:4</option><option value="1.3333333333333333">4:3</option></select></label><div class="image-editor-coordinates"><label for="imageEditorX">Vị trí X<input id="imageEditorX" type="number" min="0" step="1"></label><label for="imageEditorY">Vị trí Y<input id="imageEditorY" type="number" min="0" step="1"></label><label for="imageEditorWidth">Chiều rộng<input id="imageEditorWidth" type="number" min="1" step="1"></label><label for="imageEditorHeight">Chiều cao<input id="imageEditorHeight" type="number" min="1" step="1"></label></div><p class="image-editor-hint">Tọa độ tính bằng pixel trên ảnh gốc.</p></fieldset>
    <fieldset><legend>Xoay & lật</legend><div class="image-editor-button-grid"><button id="imageEditorRotateLeft" type="button">Xoay trái 90°</button><button id="imageEditorRotateRight" type="button">Xoay phải 90°</button><button id="imageEditorFlipX" type="button" aria-pressed="false">Lật ngang</button><button id="imageEditorFlipY" type="button" aria-pressed="false">Lật dọc</button></div></fieldset>
    <fieldset><legend>Ánh sáng & màu</legend><label class="image-editor-range" for="imageEditorBrightness"><span>Độ sáng</span><output id="imageEditorBrightnessValue" for="imageEditorBrightness">100%</output><input id="imageEditorBrightness" type="range" min="0" max="200" value="100"></label><label class="image-editor-range" for="imageEditorContrast"><span>Tương phản</span><output id="imageEditorContrastValue" for="imageEditorContrast">100%</output><input id="imageEditorContrast" type="range" min="0" max="200" value="100"></label><label class="image-editor-range" for="imageEditorSaturation"><span>Bão hòa</span><output id="imageEditorSaturationValue" for="imageEditorSaturation">100%</output><input id="imageEditorSaturation" type="range" min="0" max="200" value="100"></label></fieldset>
    <fieldset><legend>Kích thước xuất</legend><label for="imageEditorResize">Chiều rộng<select id="imageEditorResize"><option value="0">Giữ theo vùng cắt</option><option value="1280">1.280 px</option><option value="1920">1.920 px</option><option value="2560">2.560 px</option><option value="3840">3.840 px</option></select></label><p class="image-editor-hint">Nội suy trên máy, không dùng AI tăng chi tiết.</p></fieldset>
   </div></div>
  <footer class="image-editor-footer"><div><p id="imageEditorError" role="alert"></p><p class="image-editor-hint">Xử lý trên máy · tạo ảnh mới trên canvas.</p></div><div class="image-editor-footer-actions"><button id="imageEditorReset" type="button">Đặt lại</button><button id="imageEditorCancel" type="button">Hủy</button><button id="imageEditorApply" class="primary" type="submit">Tạo ảnh đã chỉnh</button></div></footer>
 </form>`;
 document.body.append(dialog);
 const $=id=>dialog.querySelector('#'+id),copy=v=>JSON.parse(JSON.stringify(v));
 let source=null,state=null,busy=false,openEpoch=0,lastFocus=null,previewTimer=null;
 const drafts=new Map();
 const keyFor=value=>String(value.nodeId||'')+'|'+value.dataUrl.length+'|'+value.dataUrl.slice(0,80)+'|'+value.dataUrl.slice(-80);
 function remember(){if(!source||!state)return;drafts.delete(source.key);drafts.set(source.key,{...copy(state),name:$('imageEditorName').value});while(drafts.size>10)drafts.delete(drafts.keys().next().value);}
 function error(message=''){$('imageEditorError').textContent=message;}
 function repaintFields(){
  $('imageEditorRatio').value=state.ratio;
  for(const [field,name]of [['X','x'],['Y','y'],['Width','width'],['Height','height']]){$('imageEditor'+field).value=state.crop[name];$('imageEditor'+field).setCustomValidity('');$('imageEditor'+field).max=field==='X'||field==='Width'?source.width:source.height;}
  $('imageEditorFlipX').setAttribute('aria-pressed',String(state.flipX));$('imageEditorFlipY').setAttribute('aria-pressed',String(state.flipY));
  for(const name of ['Brightness','Contrast','Saturation']){$('imageEditor'+name).value=state[name.toLowerCase()];$('imageEditor'+name+'Value').value=state[name.toLowerCase()]+'%';}
  $('imageEditorResize').value=String(state.resizeWidth);
 }
 function draw(canvas,size){
  canvas.width=size.width;canvas.height=size.height;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Không mở được bộ xử lý ảnh của trình duyệt.');
  const c=state.crop,quarter=Math.abs(state.rotation%180)===90,baseWidth=quarter?c.height:c.width,baseHeight=quarter?c.width:c.height;
  // Isolate the crop before interpolation, so neighboring source pixels cannot
  // bleed through the new edge while enlarging/rotating the selected region.
  const cropKey=[c.x,c.y,c.width,c.height].join(':');
  if(source.cropKey!==cropKey){const clipped=document.createElement('canvas');clipped.width=c.width;clipped.height=c.height;const clip=clipped.getContext('2d');if(!clip)throw Error('Không tạo được vùng cắt ảnh.');clip.imageSmoothingEnabled=false;clip.drawImage(source.image,c.x,c.y,c.width,c.height,0,0,c.width,c.height);source.cropImage=clipped;source.cropKey=cropKey;}
  ctx.clearRect(0,0,size.width,size.height);ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.translate(size.width/2,size.height/2);ctx.scale(size.width/baseWidth,size.height/baseHeight);ctx.scale(state.flipX?-1:1,state.flipY?-1:1);ctx.rotate(state.rotation*Math.PI/180);ctx.filter=`brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturation}%)`;ctx.drawImage(source.cropImage,-c.width/2,-c.height/2,c.width,c.height);ctx.restore();
 }
 function render(){
  if(!source||!state)return;
  try{const out=outputSize(state.crop,state.rotation,state.resizeWidth),scale=Math.min(1,1400/out.width,1000/out.height);draw($('imageEditorPreview'),{width:Math.max(1,Math.round(out.width*scale)),height:Math.max(1,Math.round(out.height*scale))});$('imageEditorDimensions').textContent=`Gốc ${source.width} × ${source.height} · Xuất ${out.width} × ${out.height} px`;error();$('imageEditorApply').disabled=busy;remember();}catch(e){error(e.message);$('imageEditorApply').disabled=true;}
 }
 function update(){repaintFields();cancelAnimationFrame(previewTimer);previewTimer=requestAnimationFrame(render);}
 function mutate(fn){if(!state||busy)return;fn();update();}
 $('imageEditorRatio').onchange=()=>mutate(()=>{state.ratio=$('imageEditorRatio').value;if(state.ratio!=='free')state.crop=ratioCrop(source.width,source.height,Number(state.ratio));});
 for(const [field,key]of [['X','x'],['Y','y'],['Width','width'],['Height','height']])$('imageEditor'+field).onchange=()=>{
  const input=$('imageEditor'+field),number=Number(input.value);if(input.value===''||!Number.isFinite(number)||number<(field==='X'||field==='Y'?0:1)){input.setCustomValidity('Nhập tọa độ và kích thước cắt hợp lệ.');error(input.validationMessage);$('imageEditorApply').disabled=true;return;}
  input.setCustomValidity('');mutate(()=>{const crop={...state.crop,[key]:number};if(state.ratio!=='free'){const ratio=Number(state.ratio);if(key==='width')crop.height=crop.width/ratio;if(key==='height')crop.width=crop.height*ratio;const scale=Math.min(1,source.width/crop.width,source.height/crop.height);crop.width*=scale;crop.height*=scale;}state.crop=cropBounds(source.width,source.height,crop);});
 };
 $('imageEditorRotateLeft').onclick=()=>mutate(()=>state.rotation=(state.rotation+270)%360);$('imageEditorRotateRight').onclick=()=>mutate(()=>state.rotation=(state.rotation+90)%360);
 $('imageEditorFlipX').onclick=()=>mutate(()=>state.flipX=!state.flipX);$('imageEditorFlipY').onclick=()=>mutate(()=>state.flipY=!state.flipY);
 for(const name of ['Brightness','Contrast','Saturation'])$('imageEditor'+name).oninput=()=>mutate(()=>state[name.toLowerCase()]=Number($('imageEditor'+name).value));
 $('imageEditorResize').onchange=()=>mutate(()=>state.resizeWidth=Number($('imageEditorResize').value));
 $('imageEditorReset').onclick=()=>mutate(()=>state=defaults(source.width,source.height));
 function close(){if(busy)return;remember();dialog.close();}
 $('imageEditorClose').onclick=$('imageEditorCancel').onclick=close;
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 dialog.addEventListener('close',()=>{remember();cancelAnimationFrame(previewTimer);if(lastFocus?.isConnected)lastFocus.focus();});
 async function decode(value){
  if(typeof value!=='string'||value.length>Math.ceil(MAX_BYTES*4/3)+2048)throw Error('Ảnh đầu vào tối đa 20 MB.');
  const embedded=/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-zA-Z0-9+/=]+$/.test(value);let local=false;
  if(!embedded){try{const url=new URL(value);local=url.protocol==='workflow:'&&url.hostname==='app'&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{}}
  if(!embedded&&!local)throw Error('Chọn ảnh đã nhập vào canvas. Bộ chỉnh sửa không tải ảnh từ website bên ngoài.');
  const response=await fetch(value);if(!response.ok)throw Error('Không đọc được ảnh nguồn.');const blob=await response.blob();if(blob.size>MAX_BYTES||!/^image\/(?:png|jpeg|webp|gif|avif)$/.test(blob.type))throw Error('Chọn ảnh PNG, JPEG, WebP, GIF hoặc AVIF, tối đa 20 MB.');
  const url=URL.createObjectURL(blob),image=new Image();try{image.src=url;await image.decode();}catch{throw Error('Ảnh nguồn không giải mã được.');}finally{URL.revokeObjectURL(url);}
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth>MAX_SIDE||image.naturalHeight>MAX_SIDE||image.naturalWidth*image.naturalHeight>MAX_PIXELS)throw Error('Ảnh nguồn tối đa 8.192 px mỗi chiều và 32 megapixel.');
  return image;
 }
 async function open(value={}){
  if(busy)throw Error('Đang thêm ảnh đã chỉnh vào canvas.');
  if(dialog.open){if(source?.nodeId===value.nodeId){$('imageEditorName').focus();return;}throw Error('Đóng bộ chỉnh sửa hiện tại trước khi chọn ảnh khác.');}
  const epoch=++openEpoch,image=await decode(value.dataUrl);if(epoch!==openEpoch)return;
  const key=keyFor(value);source={nodeId:value.nodeId,name:String(value.name||'Ảnh'),key,image,width:image.naturalWidth,height:image.naturalHeight};state=drafts.has(key)?copy(drafts.get(key)):defaults(source.width,source.height);state.crop=cropBounds(source.width,source.height,state.crop);
  $('imageEditorSourceName').textContent=source.name;$('imageEditorName').value=state.name||source.name.replace(/\.(png|jpe?g|webp|gif|avif)$/i,'')+' · chỉnh sửa';lastFocus=document.activeElement;repaintFields();render();dialog.showModal();dialog.scrollTop=0;
 }
 $('canvasImageEditorForm').onsubmit=async event=>{
  event.preventDefault();if(busy||!source||!state)return;
  if(!root.MooZCVNMediaEditorTarget?.addMedia){error('Canvas chưa sẵn sàng để nhận ảnh. Giữ cửa sổ này và thử lại.');return;}
  const name=$('imageEditorName').value.trim();if(!name){error('Nhập tên ảnh mới.');$('imageEditorName').focus();return;}
  busy=true;const controls=[...dialog.querySelectorAll('input,select,button')].map(element=>[element,element.disabled]);for(const [element]of controls)element.disabled=true;dialog.setAttribute('aria-busy','true');$('imageEditorApply').textContent='Đang tạo ảnh…';
  try{
   const canvas=document.createElement('canvas');draw(canvas,outputSize(state.crop,state.rotation,state.resizeWidth));
   const blob=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Không xuất được ảnh đã chỉnh.')),'image/png'));if(blob.size>MAX_BYTES)throw Error('Ảnh xuất lớn hơn 20 MB. Chọn chiều rộng xuất nhỏ hơn.');
   const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Không đọc được ảnh đã xuất.'));reader.readAsDataURL(blob);});
   await root.MooZCVNMediaEditorTarget.addMedia({kind:'image',dataUrl,name:name.replace(/\.(png|jpe?g|webp|gif|avif)$/i,'')+'.png',sourceNodeId:source.nodeId});drafts.delete(source.key);state=null;dialog.close();
  }catch(e){error(e?.message||'Không thêm được ảnh. Các thiết lập đang được giữ lại.');}
  finally{busy=false;dialog.removeAttribute('aria-busy');for(const [element,disabled]of controls)element.disabled=disabled;$('imageEditorApply').textContent='Tạo ảnh đã chỉnh';}
 };
 root.MooZImageEditor=Object.freeze({open});
})(globalThis);
