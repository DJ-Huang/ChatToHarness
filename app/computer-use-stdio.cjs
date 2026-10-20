#!/usr/bin/env node
'use strict';
if (process.platform === 'darwin') require('./macos-computer-use-stdio.cjs');
else if (process.platform === 'win32') require('./windows-computer-use-stdio.cjs');
else throw new Error('Computer Use supports macOS and Windows only.');
