import * as ort from './vendor/depth/ort.wasm.bundle.min.mjs';
ort.env.wasm.numThreads=1;
ort.env.wasm.wasmPaths=new URL('./vendor/depth/',import.meta.url).href;
let model;
const load=()=>model||=(ort.InferenceSession.create(new URL('./vendor/depth/model-small.onnx',import.meta.url).href,{executionProviders:['wasm'],graphOptimizationLevel:'all'}));
self.onmessage=async event=>{
 const {id,type,rgba}=event.data;
 try{
  const session=await load();
  if(type==='init'){self.postMessage({id,ready:true,model:'MiDaS v2.1 Small 256',input:session.inputNames[0],output:session.outputNames[0]});return;}
  if(!(rgba instanceof Uint8ClampedArray)||rgba.length!==256*256*4)throw Error('Khung đầu vào depth cần RGBA 256 × 256.');
  // Official MiDaS tf/run_onnx.py uses RGB 0..1. This exported model includes its normalization.
  const data=new Float32Array(3*256*256),plane=256*256;
  for(let i=0;i<plane;i++)for(let c=0;c<3;c++)data[c*plane+i]=rgba[i*4+c]/255;
  const tensor=new ort.Tensor('float32',data,[1,3,256,256]);
  const outputs=await session.run({[session.inputNames[0]]:tensor});
  const prediction=outputs[session.outputNames[0]],depth=Float32Array.from(prediction.data);
  if(depth.length!==plane||depth.some(value=>!Number.isFinite(value)))throw Error('Model trả bản đồ độ sâu không hợp lệ.');
  self.postMessage({id,depth,dims:prediction.dims},[depth.buffer]);
  tensor.dispose();for(const output of Object.values(outputs))output.dispose();
 }catch(error){self.postMessage({id,error:error.message||'Không chạy được model độ sâu local.'});}
};
