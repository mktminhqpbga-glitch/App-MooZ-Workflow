// Keep a bounded, credential-free diagnostic visible in public check annotations.
// GitHub requires login to read full logs even on this public repository.
const {spawn}=require('node:child_process');
const [command,...args]=process.argv.slice(2);let tail='';
const child=spawn(command,args,{stdio:['inherit','pipe','pipe'],env:process.env});
for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{process.stdout.write(bytes);tail=(tail+bytes.toString()).slice(-18000);});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{
 if(code!==0){const escape=value=>String(value).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');process.stdout.write(`\n::error title=Failed check ${command} ${args.join(' ')}::${escape(tail||'No output; signal '+signal)}\n`);}
 process.exitCode=code===0?0:1;
});
