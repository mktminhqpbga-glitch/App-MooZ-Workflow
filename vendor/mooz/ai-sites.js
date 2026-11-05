/* Shared, explicit website capabilities. Adding a host never grants arbitrary browsing. */
(function(root){'use strict';
 const sites={
  muse:{name:'Muse.ai',types:['text','image','video'],start:'https://muse.ai/',urls:['https://muse.ai/*','https://*.muse.ai/*']},
  chatgpt:{name:'ChatGPT',types:['text','image'],start:'https://chatgpt.com/',urls:['https://chatgpt.com/*','https://www.chatgpt.com/*','https://chat.openai.com/*']},
  gemini:{name:'Gemini',types:['text','image'],start:'https://gemini.google.com/app',urls:['https://gemini.google.com/*']},
  grok:{name:'Grok',types:['text','image','video'],start:'https://grok.com/',urls:['https://grok.com/*','https://www.grok.com/*']},
  flow:{name:'Google Flow / Veo',types:['image','video'],start:'https://flow.google.com/',urls:['https://flow.google.com/*','https://labs.google/fx/tools/flow*','https://labs.google/fx/*/tools/flow*']}
 };
 function providerForURL(value){try{if(typeof value!=='string'||/[\\\x00-\x20\x7f]/.test(value))return null;const u=new URL(value);if(u.protocol!=='https:'||u.port||u.username||u.password)return null;
 if(['chatgpt.com','www.chatgpt.com','chat.openai.com'].includes(u.hostname))return 'chatgpt';if(u.hostname==='gemini.google.com')return 'gemini';if(u.hostname==='muse.ai'||u.hostname.endsWith('.muse.ai'))return 'muse';if(['grok.com','www.grok.com'].includes(u.hostname))return 'grok';if(u.hostname==='flow.google.com')return 'flow';if(u.hostname==='labs.google'&&/^\/fx\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?tools\/flow(?:\/|$)/.test(u.pathname))return 'flow';return null;}catch{return null;}}
 const api={sites,providerForURL,patterns:Object.values(sites).flatMap(s=>s.urls)};if(typeof module!=='undefined')module.exports=api;else root.WorkflowAISites=api;
})(globalThis);
