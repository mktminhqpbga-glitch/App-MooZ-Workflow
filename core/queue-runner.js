import { api } from '../client-api.js';
import { list, mutate } from './storage.js';
import { startJob, recoverJobs } from './runner.js';
const listeners = new Set(), active = new Map();
let enabled = false, owner = false, acquiring = null, releaseOwner, concurrency = 1, pumping = false, timer, lastError = '';
const notify = () => { for (const listener of listeners) listener(state()); };
function state() { return { enabled, owner, concurrency, active: active.size, error: lastError }; }
async function acquire() {
  if (owner) return true;
  if (!navigator.locks) throw Error('Trình duyệt cần hỗ trợ Web Locks.');
  if (!acquiring) acquiring = new Promise((resolve, reject) => {
    void navigator.locks.request('mooz-cvn-batch-queue-owner', { ifAvailable: true }, async lock => {
      if (!lock) { resolve(false); return; }
      owner = true; resolve(true); notify();
      await new Promise(release => { releaseOwner = release; });
      owner = false; notify();
    }).catch(reject).finally(() => { acquiring = null; });
  });
  return acquiring;
}
async function pump() {
  if (!enabled || !owner || pumping) return;
  pumping = true;
  try {
    const records = await list('jobs');
    const held = new Map();for(const job of records)if(job.retryAt>Date.now())held.set(job.provider,Math.max(held.get(job.provider)||0,job.retryAt));
    const jobs = records.filter(job => job.batchLane != null && job.status === 'queued').sort((a,b) => a.createdAt.localeCompare(b.createdAt));
    const busy = new Set([...active.values()].map(job => job.tabId ? 'tab-' + job.tabId : 'api-' + job.provider));
    for (const job of jobs) {
      if (!enabled || active.size >= concurrency) break;
      if (active.has(job.id) || held.has(job.provider)) continue;
      let resource;
      if (job.autoTab && !job.tabId) {
        let tabs; try { tabs = await api('tabs?provider=' + job.provider); } catch (error) { lastError = error.message; continue; }
        const tab = tabs.find(tab => !tab.busy && !busy.has('tab-' + tab.id));
        if (!tab || !enabled) continue;
        const assigned = await mutate('jobs', job.id, latest => {
          if (!latest || latest.status !== 'queued') return null;
          if (!latest.tabId) { latest.tabId = tab.id; latest.chatURL = tab.url; latest.assignedTabTitle = tab.title || tab.url; }
          return latest;
        });
        if (!assigned) continue;
        Object.assign(job, assigned);
      }
      resource = job.tabId ? 'tab-' + job.tabId : 'api-' + job.provider;
      if (busy.has(resource)) continue;
      if (!enabled) break;
      busy.add(resource); active.set(job.id, job); notify();
      void startJob(job.id, notify).catch(error => { lastError = error.message; }).finally(() => { active.delete(job.id); notify(); void pump(); });
    }
  } catch (error) { lastError = error.message; }
  finally { pumping = false; notify(); }
}
export const queueRunner = {
  state,
  subscribe(listener) { listeners.add(listener); listener(state()); return () => listeners.delete(listener); },
  async start(value = concurrency) {
    if (!Number.isInteger(value) || value < 1 || value > 6) throw Error('Số tác vụ song song cần từ 1 đến 6.');
    if (!await acquire()) throw Error('Một trang khác đang quản lý hàng đợi. Dùng trang đó hoặc đóng trang đó trước.');
    await recoverJobs(); concurrency = value; enabled = true; lastError = ''; notify();
    if (!timer) timer = setInterval(() => void pump(), 1000);
    void pump();
  },
  pause() { enabled = false; notify(); },
  async release() { enabled = false; if (active.size) throw Error('Còn lượt đang xử lý; tạm dừng cấp việc mới, chờ các lượt hiện tại kết thúc.'); clearInterval(timer); timer = null; releaseOwner?.(); releaseOwner = null; },
};
