'use strict';
(() => {
  const base='/ChatToHarness/docs/',locale=document.body.dataset.locale,slug=document.body.dataset.slug;
  const input=document.getElementById('help-search'),results=document.getElementById('search-results');
  let data,load,sequence=0;
  const normalize=value=>value.normalize('NFKC').toLocaleLowerCase(locale);
  async function catalog(){return data||(load??=fetch(`${base}${locale}/search.json`).then(response=>{if(!response.ok)throw new Error('Search unavailable');return response.json();}).then(value=>data=value).catch(error=>{load=null;throw error;}));}
  // A language URL is explicit; never redirect an article to a stored language or home.
  try{localStorage.setItem('chatharness-language',locale);}catch{}
  for(const link of document.querySelectorAll('[data-language]'))link.addEventListener('click',()=>{try{localStorage.setItem('chatharness-language',link.dataset.language);}catch{}if(location.hash)link.hash=location.hash;});
  function paragraph(text){const p=document.createElement('p');p.textContent=text;return p;}
  async function search(){
    const current=++sequence,query=normalize(input.value.trim());
    results.replaceChildren();results.hidden=!query;if(!query)return;
    try{
      const {articles,messages:m}=await catalog();if(current!==sequence)return;
      const words=query.split(/\s+/).filter(Boolean);
      const scored=articles.map(article=>{const title=normalize(article.title),text=normalize(article.text),keywords=normalize(article.keywords||'');return {article,score:words.reduce((sum,word)=>sum+(title.includes(word)?15:0)+(keywords.includes(word)?5:0)+(text.includes(word)?1:0),0),matches:words.every(word=>text.includes(word)||title.includes(word)||keywords.includes(word))};}).filter(item=>item.matches&&item.score>0).sort((a,b)=>b.score-a.score).slice(0,12);
      results.replaceChildren(paragraph(m.results));
      if(!scored.length)results.append(paragraph(m.empty));
      for(const {article}of scored){const a=document.createElement('a');a.href=article.url;a.textContent=article.title;a.append(paragraph(article.summary));results.append(a);}
    }catch{if(current!==sequence)return;results.textContent={en:'Search unavailable. Browse the topics below.','zh-CN':'暂时无法搜索，请使用主题导航。',ja:'検索を利用できません。トピックからお探しください。'}[locale];}
  }
  input?.addEventListener('input',search);
  input?.form.addEventListener('submit',event=>{event.preventDefault();void search();});
  input?.form.addEventListener('reset',()=>{++sequence;results.hidden=true;results.replaceChildren();input.focus();});
  document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key==='k'){event.preventDefault();input?.focus();}if(event.key==='Escape'&&results){++sequence;results.hidden=true;}});
  const toggle=document.getElementById('topics-toggle'),nav=document.getElementById('topics-nav');
  toggle?.addEventListener('click',()=>{const open=nav.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open));});
  const dialog=document.getElementById('image-dialog');
  if(dialog?.showModal){
    dialog.querySelector('button').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    for(const link of document.querySelectorAll('[data-zoom]'))link.addEventListener('click',event=>{event.preventDefault();const img=dialog.querySelector('img');img.src=link.href;img.alt=link.querySelector('img').alt;dialog.showModal();});
  }
  const copyLabels={en:['Copy example','Copied','Select and copy the example'],'zh-CN':['复制示例','已复制','请选择并复制示例'],ja:['例文をコピー','コピーしました','例文を選択してコピーしてください']}[locale];
  for(const pre of document.querySelectorAll('.prose pre')){
    const code=pre.querySelector('code');if(!code)continue;
    const button=document.createElement('button');button.className='copy-example';button.type='button';button.textContent=copyLabels[0];button.setAttribute('aria-live','polite');
    button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(code.textContent.trimEnd());button.textContent=copyLabels[1];}catch{const selection=getSelection(),range=document.createRange();range.selectNodeContents(code);selection.removeAllRanges();selection.addRange(range);button.textContent=copyLabels[2];}setTimeout(()=>button.textContent=copyLabels[0],2500);});pre.append(button);
  }
})();
