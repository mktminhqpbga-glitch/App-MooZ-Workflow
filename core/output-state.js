const generated = type => type.startsWith('generate') || !['prompt','negativePrompt','imageInput','videoInput','audioInput','preview'].includes(type);
function digest(text) { let a=2166136261,b=2246822519;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),3266489917);}return (a>>>0).toString(16)+(b>>>0).toString(16)+'-'+text.length; }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])); return value; }
export function outputKey(graph, id, configurationOnly = false) {
 const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const edge of graph.edges)if(ids.has(edge.target)&&!ids.has(edge.source)){ids.add(edge.source);changed=true;}}
 const nodes=graph.nodes.filter(node=>ids.has(node.id)).map(node=>{const data={...node.data};delete data.outputKey;delete data.customName;delete data.resultAssets;if(generated(node.type)&&(configurationOnly||node.id===id)){delete data.assetId;delete data.text;}return {id:node.id,type:node.type,data};}).sort((a,b)=>a.id.localeCompare(b.id));
 const edges=graph.edges.filter(edge=>ids.has(edge.source)&&ids.has(edge.target)).map(edge=>({...edge}));
 return digest(JSON.stringify(canonical({nodes,edges})));
}
export function mergeJobOutputs(graph, job) {
 const next=structuredClone(graph), accepted=[];
 for(const [id,output]of Object.entries(job.outputs||{})){
  const node=next.nodes.find(node=>node.id===id), old=job.graph.nodes.find(node=>node.id===id);
  if(!node||!old||!generated(node.type)||output.accepted===false||outputKey(graph,id,true)!==outputKey(job.graph,id,true))continue;
  if(output.assetId){node.data.assetId=output.assetId;accepted.push(id);}
  else if(output.kind==='text'&&typeof output.text==='string'){node.data.text=output.text;accepted.push(id);}
 }
 for(const id of accepted)next.nodes.find(node=>node.id===id).data.outputKey=outputKey(next,id);
 return next;
}
export function isStale(graph,node) { return !!node.data.outputKey && node.data.outputKey!==outputKey(graph,node.id); }
