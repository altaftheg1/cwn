import fetch from 'node-fetch';\nimport { load } from 'cheerio';\n(async()=>{\n  const url='https://www.emirates247.com/uae/uae-extends-distance-learning-until-friday-march-6-2026-2026-03-03-1.744502';\n  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});\n  const html=await r.text();\n  const $=load(html);\n  let img=.attr('content')||.attr('content')||'';\n  console.log('meta',img);\n  if(!img){\n    const cand=.first().attr('src')||'';\n    console.log('cand',cand);
    img=cand;
  }\n  try{img=new URL(img,url).toString();}catch{}\n  console.log('final',img);\n})();
