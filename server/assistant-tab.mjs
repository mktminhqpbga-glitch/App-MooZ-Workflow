import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
const providers = ['muse', 'gemini', 'chatgpt', 'grok'];
export class AssistantTab {
  constructor(directory) { this.directory = directory; this.current = null; this.pending = Promise.resolve(); }
  async init() {
    try {
      const value = JSON.parse(await readFile(join(this.directory, 'assistant-tab.json'), 'utf8'));
      if (value !== null && (!Number.isSafeInteger(value.tabId) || !providers.includes(value.provider))) throw Error('Cấu hình tab trợ lý không hợp lệ.');
      this.current = value;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  snapshot() { return this.current ? structuredClone(this.current) : null; }
  assertJob(input) {
    if (input.purpose === 'assistant') {
      if (!this.current || input.tabId !== this.current.tabId || input.provider !== this.current.provider)
        throw Error('Tab trợ lý đã thay đổi. Hãy gửi lại từ bảng Trợ lý AI.');
    } else if (this.current && Number(input.tabId) === this.current.tabId) {
      throw Error('Tab này dành riêng cho Trợ lý AI; công việc khác không được sử dụng.');
    }
  }
  configure(selection, { check, isBusy }) {
    const operation = async () => {
      let next = null;
      if (selection !== null) {
        if (!selection || !providers.includes(selection.provider) || !Number.isSafeInteger(selection.tabId) || selection.tabId <= 0)
          throw Error('Chọn dịch vụ và tab trợ lý hợp lệ.');
        const tab = await check(selection);
        next = { provider: selection.provider, tabId: tab.id, title: String(tab.title || tab.url || '').slice(0, 300), chatURL: tab.url, assignedAt: new Date().toISOString() };
      }
      if ([this.current?.tabId, next?.tabId].some(id => id && isBusy(id)))
        throw Error('Tab đang có công việc chạy. Chờ hoàn tất trước khi đổi vai trò.');
      const previous = this.current;
      // Claim synchronously before persistence so a racing job cannot acquire this tab.
      this.current = next;
      try {
        await mkdir(this.directory, { recursive: true });
        const file = join(this.directory, 'assistant-tab.json');
        await writeFile(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
        await rename(file + '.tmp', file);
      } catch (error) { this.current = previous; throw error; }
      return this.snapshot();
    };
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }
}
