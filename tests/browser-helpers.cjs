exports.waitForAsync=async(page,predicate,arg,{timeout=30000}={})=>{
 const deadline=Date.now()+timeout;let last;
 do{last=await page.evaluate(predicate,arg);if(last)return last;await page.waitForTimeout(50);}while(Date.now()<deadline);
 throw Error('Timed out awaiting durable browser state: '+String(predicate));
};
