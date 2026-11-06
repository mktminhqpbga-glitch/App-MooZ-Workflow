import {mkdir,readFile,writeFile,copyFile,rename,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
export const depthModel={url:'https://github.com/isl-org/MiDaS/releases/download/v2_1/model-small.onnx',sha256:'2d8c6cb8f415229daf1eb041024208e2608c9f98e17c81cc7c6ecb449c56fd58'};
await mkdir('vendor/depth',{recursive:true});
const file='vendor/depth/model-small.onnx';
let found=false;try{await stat(file);found=true;}catch{}
if(!found){execFileSync('curl',['--fail','--location','--retry','2','--max-time','180','--output',file+'.download',depthModel.url],{stdio:'inherit'});const hash=createHash('sha256').update(await readFile(file+'.download')).digest('hex');if(hash!==depthModel.sha256)throw Error('Model depth checksum mismatch');await rename(file+'.download',file);}
if(createHash('sha256').update(await readFile(file)).digest('hex')!==depthModel.sha256)throw Error('Model depth checksum mismatch');
for(const name of ['ort.wasm.bundle.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'])await copyFile('node_modules/onnxruntime-web/dist/'+name,'vendor/depth/'+name);

