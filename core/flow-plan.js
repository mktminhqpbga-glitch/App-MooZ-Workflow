import { emptyGraph, validateGraph } from './graph.js';
export function buildFlow({ kind, prompt, references = [], scenes = 1, createImages = false, negative = '', size = '16:9', duration = null, quality = 'medium', resolution = kind === 'video' ? '720P' : '1K', background = 'auto' }) {
  if (!['image', 'video'].includes(kind) || !Number.isInteger(scenes) || scenes < 1 || scenes > 12) throw Error('Loại luồng/số cảnh không hợp lệ.');
  const graph = emptyGraph(), roles = Object.fromEntries(references.map(ref => [ref.id, ref.role || 'reference']));
  const add = (type, name, data, x, y) => {
    const node = { id: crypto.randomUUID(), type, x, y, data: { customName: name, ...data } }; graph.nodes.push(node); return node;
  };
  const edge = (source, target, sourcePort, targetPort) => graph.edges.push({ id: crypto.randomUUID(), source: source.id, target: target.id, sourcePort, targetPort });
  const inputs = references.map((ref, index) => add('imageInput', (ref.role === 'character' ? 'Nhân vật · ' : 'Ảnh · ') + ref.name, { assetId: ref.id }, 0, index * 225));
  const negativeNode = negative.trim() ? add('negativePrompt', 'Negative prompt chung', { text: negative }, 0, inputs.length * 225) : null;
  const common = { size, duration, quality, resolution, background, referenceRoles: JSON.stringify(roles) };
  const refsTo = target => { for (const input of inputs) edge(input, target, 'image', 'reference'); if (negativeNode) edge(negativeNode, target, 'text', 'negative'); };
  if (kind === 'image') {
    const image = add('generateImage', 'Tạo ảnh', { ...common, studioPrompt: prompt }, 480, 0); refsTo(image);
  } else {
    let script;
    if (scenes > 1) {
      script = add('generateText', 'Kịch bản ' + scenes + ' cảnh', { sceneCount: scenes, studioPrompt: prompt, referenceRoles: JSON.stringify(roles) }, 420, 0); refsTo(script);
    }
    const videos = [];
    for (let index = 1; index <= scenes; index++) {
      let image;
      if (createImages) {
        image = add('generateImage', 'Ảnh cảnh ' + index, { ...common, resolution: ['1K','2K','4K'].includes(resolution) ? resolution : '1K', studioPrompt: script ? '' : prompt, ...(script ? { sceneIndex: index } : {}) }, 850, (index - 1) * 290);
        refsTo(image); if (script) edge(script, image, 'text', 'prompt');
      }
      const video = add('generateVideo', 'Video cảnh ' + index, { ...common, studioPrompt: script ? '' : prompt, ...(script ? { sceneIndex: index } : {}) }, createImages ? 1450 : 850, (index - 1) * 290);
      if (image) edge(image, video, 'image', 'reference'); else refsTo(video);
      if (script) edge(script, video, 'text', 'prompt');
      if (negativeNode && image) edge(negativeNode, video, 'text', 'negative');
      videos.push(video);
    }
    const output = add('assembleVideo', 'MP4 thành phẩm', {}, createImages ? 2050 : 1450, 0);
    for (const video of videos) edge(video, output, 'video', 'videos');
  }
  if (graph.nodes.length > 40 || graph.edges.length > 120) throw Error('Luồng tối đa 40 node / 120 dây; giảm số ảnh tham chiếu hoặc số cảnh.');
  graph.groups.push({ id: crypto.randomUUID(), name: 'Kế hoạch · chưa gửi AI', nodeIds: graph.nodes.map(node => node.id) });
  return validateGraph(graph);
}

export function buildContinuation({ source, sourceDuration, targetDuration, duration, prompt, references = [], size='16:9', quality='medium', resolution='720P', negative='' }) {
  if (!source?.id || source.kind!=='video' || !Number.isFinite(sourceDuration) || sourceDuration<=0 || !Number.isFinite(targetDuration) || targetDuration<=sourceDuration+.05) throw Error('Chọn video thật và thời lượng mục tiêu lớn hơn nguồn.');
  if (!Number.isFinite(duration) || duration<=0 || duration>40) throw Error('Chọn thời lượng dự kiến mỗi đoạn tiếp nối.');
  const count=Math.ceil((targetDuration-sourceDuration)/duration);if(count>12)throw Error('Tối đa 12 đoạn tiếp nối; giảm thời lượng mục tiêu.');
  if(references.length>7)throw Error('Tối đa 7 ảnh bổ sung khi dùng frame cuối làm ảnh thứ nhất.');
  const graph=emptyGraph(),add=(type,name,data,x,y)=>{const node={id:crypto.randomUUID(),type,x,y,data:{customName:name,...data}};graph.nodes.push(node);return node;},edge=(source,target,sourcePort,targetPort)=>graph.edges.push({id:crypto.randomUUID(),source:source.id,target:target.id,sourcePort,targetPort});
  const original=add('videoInput','Video nguồn giữ nguyên',{assetId:source.id},0,0),refs=references.map((ref,index)=>add('imageInput',ref.name,{assetId:ref.id},0,(index+1)*225)),clips=[original];let previous=original;
  for(let index=0;index<count;index++){
    const frame=add('captureLastFrame','Frame cuối đoạn '+index,{},400+index*720,0);edge(previous,frame,'video','video');
    const clip=add('generateVideo','Đoạn tiếp nối '+(index+1),{studioPrompt:prompt+'\nẢnh 1 là khung cuối đoạn trước; tiếp tục chuyển động và giữ nhận diện, ánh sáng, bối cảnh. Không lặp cảnh mở đầu.',size,duration,quality,resolution,negativePrompt:negative},700+index*720,0);edge(frame,clip,'image','reference');for(const ref of refs)edge(ref,clip,'image','reference');clips.push(clip);previous=clip;
  }
  const output=add('assembleVideo','MP4 đủ thời lượng',{localSettings:JSON.stringify({targetDuration})},700+count*720,0);for(const clip of clips)edge(clip,output,'video','videos');
  if(graph.nodes.length>40||graph.edges.length>120)throw Error('Luồng tiếp nối vượt 40 node / 120 dây.');return validateGraph(graph);
}
