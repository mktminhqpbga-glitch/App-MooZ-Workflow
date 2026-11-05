import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
export class ServerJobs {
  constructor(directory, execute) {
    this.directory = directory;
    this.execute = execute;
    this.resources = new Map();
    this.active = new Map();
  }
  path(id) {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      throw Error("Mã yêu cầu không hợp lệ.");
    return join(this.directory, id + ".json");
  }
  async get(id) {
    try {
      return JSON.parse(await readFile(this.path(id), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async put(record) {
    await mkdir(this.directory, { recursive: true });
    const p = this.path(record.id);
    await writeFile(p + ".tmp", JSON.stringify(record), { mode: 0o600 });
    await rename(p + ".tmp", p);
  }
  async run(input) {
    const id = input.requestId;
    this.path(id);
    const digest = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    if (this.active.has(id)) {
      const a = this.active.get(id);
      if (a.digest !== digest)
        throw Error("Mã yêu cầu đã dùng cho dữ liệu khác.");
      return a.promise;
    }
    const promise = this.perform(input, digest);
    this.active.set(id, { digest, promise });
    try {
      return await promise;
    } finally {
      this.active.delete(id);
    }
  }
  async perform(input, digest) {
    const prior = await this.get(input.requestId);
    if (prior) {
      if (prior.digest !== digest)
        throw Error("Mã yêu cầu đã dùng cho dữ liệu khác.");
      return prior;
    }
    const record = {
      id: input.requestId,
      digest,
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    await this.put(record);
    const resource = input.tabId
        ? "tab:" + input.tabId
        : "api:" + input.provider,
      previous = this.resources.get(resource) || Promise.resolve();
    let release;
    const lease = new Promise((r) => (release = r));
    const tail = previous.catch(() => {}).then(() => lease);
    this.resources.set(resource, tail);
    await previous.catch(() => {});
    try {
      const result = await this.execute(input, async () => {
        record.status = "sent";
        await this.put(record);
      });
      record.status = "success";
      record.result = result;
    } catch (e) {
      record.error = String(e.message || e).slice(0, 1000);
      record.status = record.status === "sent" ? "unknown" : "error";
      record.code = e.code;
      record.retryAfterMs = e.retryAfterMs;
    } finally {
      record.updatedAt = new Date().toISOString();
      try {
        await this.put(record);
      } finally {
        release();
        if (this.resources.get(resource) === tail)
          this.resources.delete(resource);
      }
    }
    return record;
  }
}
