import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServerJobs } from "../server/jobs.mjs";
import { generateAPI } from "../server/providers.mjs";
import { ChromeConnection } from "../server/connection.mjs";
import { WebSocket } from "ws";
test("persistent idempotency: concurrent duplicate sends once, payload reuse rejected, restart does not resend", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooz-jobs-"));
  try {
    let count = 0;
    const service = new ServerJobs(dir, async (input, sent) => {
        count++;
        await sent();
        await new Promise((r) => setTimeout(r, 20));
        return { kind: "text", text: input.prompt };
      }),
      input = {
        requestId: crypto.randomUUID(),
        provider: "test",
        prompt: "one",
      };
    const [a, b] = await Promise.all([service.run(input), service.run(input)]);
    assert.equal(count, 1);
    assert.equal(a.status, "success");
    assert.deepEqual(a, b);
    await assert.rejects(
      () => service.run({ ...input, prompt: "two" }),
      /dữ liệu khác/,
    );
    const restart = new ServerJobs(dir, () => {
      throw Error("should not execute");
    });
    assert.equal((await restart.run(input)).status, "success");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("same-tab jobs serialize; response loss stays unknown on restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooz-lease-"));
  try {
    let active = 0,
      max = 0;
    const service = new ServerJobs(dir, async (input, sent) => {
      active++;
      max = Math.max(max, active);
      await sent();
      await new Promise((r) => setTimeout(r, 10));
      active--;
      if (input.fail) throw Error("Lost response");
      return { kind: "text", text: "ok" };
    });
    const inputs = [
      { requestId: crypto.randomUUID(), tabId: 8, fail: true },
      { requestId: crypto.randomUUID(), tabId: 8 },
    ];
    const [a, b] = await Promise.all(inputs.map((i) => service.run(i)));
    assert.equal(max, 1);
    assert.equal(a.status, "unknown");
    assert.equal(b.status, "success");
    const restart = new ServerJobs(dir, () => {
      throw Error("retry forbidden");
    });
    assert.equal((await restart.run(inputs[0])).status, "unknown");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("API request uses fixed official host and configured key, rejects missing key and wrong output", async () => {
  let call;
  const result = await generateAPI(
    { provider: "openai", mediaType: "text", prompt: "test" },
    {
      env: { MOOZ_OPENAI_KEY: "fixture-not-real" },
      fetchImpl: async (url, options) => {
        call = { url, options };
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Fixture text" } }],
          }),
          { status: 200 },
        );
      },
    },
  );
  assert.equal(result.text, "Fixture text");
  assert.equal(call.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(call.options.redirect, "error");
  assert.equal(call.options.headers.Authorization, "Bearer fixture-not-real");
  await assert.rejects(
    () =>
      generateAPI(
        { provider: "openai", mediaType: "text", prompt: "x" },
        { env: {} },
      ),
    /Chưa cấu hình/,
  );
  await assert.rejects(
    () =>
      generateAPI(
        { provider: "openai", mediaType: "video", prompt: "x" },
        { env: { MOOZ_OPENAI_KEY: "fixture" } },
      ),
    /chưa hỗ trợ/,
  );
});
test("existing MooZ Connect local protocol pairs, lists and validates tab before dispatch; no real AI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mooz-relay-"));
  const connection = new ChromeConnection(dir, {});
  let socket;
  try {
    await connection.init();
    const pair = await connection.pair(),
      uri = new URL(pair.uri);
    socket = new WebSocket("ws://127.0.0.1:" + uri.port, {
      origin: "chrome-extension://" + "a".repeat(32),
    });
    await new Promise((resolve, reject) => {
      socket.on("error", reject);
      socket.on("open", () =>
        socket.send(
          JSON.stringify({
            type: "auth",
            token: uri.pathname.slice(1),
            protocol: 1,
            extensionVersion: "1.9.2",
          }),
        ),
      );
      socket.on("message", (bytes) => {
        const m = JSON.parse(bytes);
        if (m.type === "ready") resolve();
      });
    });
    let sends = 0;
    socket.on("message", (bytes) => {
      const m = JSON.parse(bytes);
      if (m.type !== "request") return;
      let result;
      if (m.operation === "tabs.query")
        result = [
          {
            id: 8,
            url: "https://gemini.google.com/app/chosen",
            title: "Fixture Gemini",
          },
        ];
      else if (m.operation === "tabs.get")
        result = { id: 8, url: "https://gemini.google.com/app/chosen" };
      else if (
        m.operation === "tabs.message" &&
        m.payload.message.type === "WORKFLOW_AI_CHECK"
      )
        result = { ok: true, composer: true, signedIn: true, sendProtocol: 1 };
      else if (m.operation === "tabs.message") {
        sends++;
        result = {
          ok: true,
          text: "Protocol fixture",
          requestId: m.payload.message.requestId,
        };
      } else result = [{ result: true }];
      socket.send(JSON.stringify({ type: "response", id: m.id, result }));
    });
    assert.equal((await connection.tabs("gemini")).length, 1);
    await connection.check({
      provider: "gemini",
      tabId: 8,
      chatURL: "https://gemini.google.com/app/chosen",
    });
    await assert.rejects(
      () =>
        connection.check({
          provider: "gemini",
          tabId: 8,
          chatURL: "https://gemini.google.com/app/other",
        }),
      /đã thay đổi/,
    );
    const result = await connection.generate({
      provider: "gemini",
      tabId: 8,
      chatURL: "https://gemini.google.com/app/chosen",
      mediaType: "text",
      prompt: "test",
      requestId: crypto.randomUUID(),
    });
    assert.equal(result.text, "Protocol fixture");
    assert.equal(sends, 1);
  } finally {
    socket?.terminate();
    await connection.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('OpenAI image references use multipart edit endpoint and preserve file bytes', async()=>{
 const response=await generateAPI({provider:'openai',mediaType:'image',prompt:'Giữ nhân vật',referenceImages:['data:image/png;base64,AQID'],size:'9:16'}, {env:{MOOZ_OPENAI_KEY:'fixture'},fetchImpl:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/images/edits');assert.ok(options.body instanceof FormData);assert.equal(options.headers['Content-Type'],undefined);assert.deepEqual(new Uint8Array(await options.body.get('image[]').arrayBuffer()),new Uint8Array([1,2,3]));return Response.json({data:[{b64_json:'AQID'}]});}});
 assert.equal(response.kind,'image');
});
