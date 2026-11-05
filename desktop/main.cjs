const { app, BrowserWindow, utilityProcess, dialog, shell, Menu } = require('electron');
const path = require('node:path'), crypto = require('node:crypto');
let server, window, quitting = false;
if (process.env.MOOZ_DESKTOP_PROFILE) app.setPath('userData', process.env.MOOZ_DESKTOP_PROFILE);
if (!app.requestSingleInstanceLock()) app.quit();
else {
 app.on('second-instance', () => { if (window) { if(window.isMinimized())window.restore();window.focus(); } });
 app.whenReady().then(async () => {
  const root = app.getAppPath(), token = crypto.randomBytes(32).toString('hex'), port = Number(process.env.MOOZ_DESKTOP_PORT || 4174);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Cổng desktop không hợp lệ.');
  const origin = 'http://127.0.0.1:' + port;
  server = utilityProcess.fork(path.join(root, 'server.mjs'), [], { cwd: root, stdio: 'pipe', env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), MOOZ_ACCESS_TOKEN: token, MOOZ_RUNTIME_DIR: path.join(app.getPath('userData'), 'runtime') } });
  await new Promise((resolve, reject) => {
   const timer=setTimeout(()=>reject(Error('Máy chủ local chưa khởi động được sau 30 giây.')),30000);
   server.stdout.on('data', bytes => { if(String(bytes).includes('MooZ CVN server on port')) {clearTimeout(timer);resolve();} });
   server.once('exit',code=>{clearTimeout(timer);reject(Error('Máy chủ local dừng ('+code+'). Kiểm tra cổng '+port+' có đang được dùng không.'));});
  });
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 880, minHeight: 640, title: 'MooZ CVN', backgroundColor: '#171819', webPreferences: { preload: path.join(root,'desktop/preload.cjs'), additionalArguments: ['--mooz-access='+token], nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  window.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))void shell.openExternal(url);return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/')){event.preventDefault();if(/^https:\/\//.test(url))void shell.openExternal(url);}});
  window.webContents.session.setPermissionRequestHandler((_webContents,permission,callback)=>callback(['clipboard-sanitized-write','fullscreen'].includes(permission)));
  Menu.setApplicationMenu(Menu.buildFromTemplate([{role:'appMenu'},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}]));
  await window.loadURL(origin + '/');
  server.on('exit',()=>{if(!quitting)dialog.showErrorBox('Máy chủ đã dừng','Các request đang gửi cần được kiểm tra trước khi chạy lại. Đóng và mở lại app để khởi động máy chủ.');});
 }).catch(error=>{dialog.showErrorBox('Chưa mở được MooZ CVN',error.message);app.quit();});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{quitting=true;server?.kill();});
}
