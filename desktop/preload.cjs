const { contextBridge } = require('electron');
const accessCode = process.argv.find(argument => argument.startsWith('--mooz-access='))?.slice(14) || '';
contextBridge.exposeInMainWorld('moozDesktop', Object.freeze({ accessCode, version: '0.4.0', platform: process.platform, arch: process.arch }));
