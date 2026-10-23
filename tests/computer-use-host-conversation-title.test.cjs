'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {fromHostMetadata,META_KEY}=require('../app/computer-use-conversation-title.cjs');
const {ComputerUseSwitch}=require('../app/builtin-computer-use.cjs');

test('only explicit custom host metadata can supply a ChatGPT conversation title',()=>{
  assert.equal(fromHostMetadata({'openai/session':'anonymous-id'}),undefined);
  assert.equal(fromHostMetadata({}),undefined);
  assert.equal(fromHostMetadata({[META_KEY]:'  真实聊天标题  '}),'真实聊天标题');
  for(const bad of ['', ' ', 'evil\nnewline', 'x'.repeat(81), {text:'fake'}]){
    assert.equal(fromHostMetadata({[META_KEY]:bad}),undefined);
  }
});
test('public Computer Use tool does not expose model-guessable conversation_title',async t=>{
  for(const platform of ['darwin','win32']){
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cth-host-title-'));
    t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
    fs.mkdirSync(path.join(tmp,'computer-use'));
    fs.writeFileSync(path.join(tmp,'computer-use',platform==='darwin'?'ChatToHarness.MacComputerUse':'ChatToHarness.ComputerUse.exe'),'test');
    const received=[];
    const make=()=>({stop(){},async call(args){received.push(args);return {structuredContent:{ok:true}}}});
    const cu=new ComputerUseSwitch({platform,resources:tmp,enabled:true,
      createMac:make,createWindows:make});
    t.after(()=>cu.dispose());
    assert.equal(cu.definition().inputSchema.properties.conversation_title,undefined);
    const guessed={action:'open_session',session_title:'Move window',conversation_title:'AI guessed wrong'};
    await cu.call(guessed);
    assert.equal(received[0].conversation_title,undefined);
    assert.equal(received[0].session_title,'Move window');
    assert.equal(guessed.conversation_title,'AI guessed wrong','do not mutate caller objects');
    await cu.call(guessed,{hostConversationTitle:'Exact title supplied by host'});
    assert.equal(received[1].conversation_title,'Exact title supplied by host');
    await cu.call(guessed,{hostConversationTitle:'fake\nnewline'});
    assert.equal(received[2].conversation_title,undefined);
  }
});
test('gateway to native service carries only host-side title metadata, never anonymized session ID',()=>{
  const gateway=fs.readFileSync(path.join(__dirname,'../app/mcp-gateway.cjs'),'utf8');
  const manager=fs.readFileSync(path.join(__dirname,'../app/mcp-manager.cjs'),'utf8');
  assert.match(gateway,/hostConversationTitle:\s*request\.params\.name/);
  assert.match(gateway,/fromHostMetadata\(request\.params\._meta\)/);
  assert.match(manager,/hostConversationTitle/);
});
