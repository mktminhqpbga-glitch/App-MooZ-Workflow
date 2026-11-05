import { list, contentDB } from './storage.js';
import { ProjectRepository, createProject } from './projects.js';
import { createJob } from './runner.js';
import { splitPrompts, prepareBatch, limits } from './queue-plan.js';
import { validateGraph } from './graph.js';
const repo = new ProjectRepository();
export async function prepareJobs(options) {
  if (!navigator.locks) throw Error('Cần Chrome/Edge mới qua HTTPS hoặc localhost để quản lý queue.');
  return navigator.locks.request('mooz-cvn-queue-prepare', async () => {
    const existing = (await list('jobs')).filter(job => job.batchLane != null),
      prompts = splitPrompts(options.text, options.mode),
      plans = prepareBatch({ prompts, assets: options.assets, sourceId: options.sourceId, characterIds: options.characterIds, copies: options.copies, existingJobs: existing });
    const projects = [], jobs = [];
    for (const plan of plans) {
      const graph = validateGraph(await options.graph(plan));
      if (graph.nodes.length > 40 || graph.edges.length > 120) throw Error('Mỗi luồng tối đa 40 node / 120 dây.');
      const project = createProject((plan.originalPrompt.slice(0, 48) || 'Tác vụ') + (plan.copies > 1 ? ` · ${plan.copy}/${plan.copies}` : ''));
      project.graph = graph;
      const job = await createJob({ graph, projectId: project.id, provider: options.provider, tabId: options.tabId, chatURL: options.chatURL, autoTab: options.autoTab, title: project.name, kind: options.kind, batchLane: 1, persist: false, originalPrompt: plan.originalPrompt });
      job.references = plan.references; job.planVersion = 'mooz-cvn-flow-v1';
      projects.push(project); jobs.push(job);
    }
    const created = [];
    try {
      for (const project of projects) created.push(await repo.save(project, { create: true }));
      const db = await contentDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('jobs', 'readwrite'), store = tx.objectStore('jobs'), request = store.getAll(); let error;
        request.onsuccess = () => {
          const old = request.result.filter(job => job.batchLane != null);
          if (old.length + jobs.length > limits.jobs) { error = Error('Hàng đợi đã đầy 200 job.'); tx.abort(); return; }
          const bytes = new Map();
          for (const job of [...old, ...jobs]) for (const [id, asset] of Object.entries(job.inputAssets || {})) if (asset.kind === 'image') bytes.set(id, asset.blob?.size || 0);
          if ([...bytes.values()].reduce((sum, size) => sum + size, 0) > limits.snapshotBytes) { error = Error('Snapshot ảnh hàng đợi vượt 32 MB.'); tx.abort(); return; }
          for (const job of jobs) store.add(job);
        };
        tx.oncomplete = resolve; tx.onerror = () => reject(error || tx.error); tx.onabort = () => reject(error || tx.error || Error('Chưa chốt được hàng đợi.'));
      });
    } catch (error) {
      for (const project of created) await repo.delete(project.id, project.revision).catch(() => {});
      throw error;
    }
    return jobs;
  });
}
