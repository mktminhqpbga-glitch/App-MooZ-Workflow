const number=(value,min,max,label)=>{const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw Error(`${label}: cần số từ ${min} đến ${max}.`);return n;};
export function finishingPlan(settings={},videoDuration,musicDuration=null){
 const end=number(settings.videoEnd??videoDuration,0,videoDuration,'Kết thúc video'),start=number(settings.videoStart??0,0,end,'Bắt đầu video');
 if(end-start<.05)throw Error('Đoạn video phải dài ít nhất 0,05 giây.');
 const plan={videoStart:start,videoEnd:end,duration:end-start,brightness:number(settings.brightness??0,-.5,.5,'Độ sáng'),contrast:number(settings.contrast??1,.1,3,'Tương phản'),saturation:number(settings.saturation??1,0,3,'Bão hòa'),originalVolume:number(settings.originalVolume??1,0,2,'Âm lượng tiếng gốc'),musicVolume:number(settings.musicVolume??.5,0,2,'Âm lượng nhạc'),loop:settings.loop===true};
 if(musicDuration!==null){plan.musicStart=number(settings.musicStart??0,0,musicDuration,'Bắt đầu nhạc');plan.musicEnd=number(settings.musicEnd??musicDuration,0,musicDuration,'Kết thúc nhạc');if(plan.musicEnd-plan.musicStart<.05)throw Error('Đoạn nhạc phải dài ít nhất 0,05 giây.');}
 return plan;
}
