'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

test('native pointer recovery yields to slow movement and resumes only after continuous quiet',
  {skip:process.platform!=='win32'},()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cth-pointer-quiet-'));
    try {
      const executable=path.join(directory,'PointerQuiet.exe');
      const compiler=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
      execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/main:ComputerUsePointerQuietFixture',
        '/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll','/out:'+executable,
        path.resolve(__dirname,'../native/ComputerUse.cs'),path.join(__dirname,'fixtures/computer-use-pointer-quiet.cs')],
      {windowsHide:true});
      assert.match(execFileSync(executable,[],{windowsHide:true,encoding:'utf8',timeout:10000}),/POINTER_QUIET_PASS/);
    } finally {fs.rmSync(directory,{recursive:true,force:true});}
  });

test('native pointer logs rotate, serialize concurrent helpers, and tolerate unavailable storage',
  {skip:process.platform!=='win32'},()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cth-pointer-logs-'));
    try {
      const executable=path.join(directory,'PointerDiagnostics.exe');
      const compiler=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
      execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/main:ComputerUsePointerDiagnosticsFixture',
        '/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll','/out:'+executable,
        path.resolve(__dirname,'../native/ComputerUse.cs'),path.join(__dirname,'fixtures/computer-use-pointer-diagnostics.cs')],{windowsHide:true});
      assert.match(execFileSync(executable,[directory],{windowsHide:true,encoding:'utf8',timeout:10000}),/POINTER_DIAGNOSTICS_PASS/);
    } finally {fs.rmSync(directory,{recursive:true,force:true});}
  });
