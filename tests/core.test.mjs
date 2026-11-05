import test from "node:test";
import assert from "node:assert/strict";
import {
  GraphController,
  emptyGraph,
  validateGraph,
  topologicalOrder,
} from "../core/graph.js";
import {
  createProject,
  exportProject,
  importProject,
} from "../core/projects.js";
const node = (id, type) => ({ id, type, x: 0, y: 0, data: {} }),
  edge = (id, source, sourcePort, target, targetPort) => ({
    id,
    source,
    sourcePort,
    target,
    targetPort,
  });
test("typed graph orders dependencies and rejects wrong ports and cycles atomically", () => {
  const c = new GraphController();
  for (const n of [
    node("p", "prompt"),
    node("a", "generateText"),
    node("b", "generateText"),
    node("i", "imageInput"),
  ])
    c.execute({ type: "addNode", node: n });
  c.execute({ type: "connect", edge: edge("pa", "p", "text", "a", "prompt") });
  c.execute({ type: "connect", edge: edge("ab", "a", "text", "b", "prompt") });
  const before = c.snapshot();
  assert.deepEqual(
    topologicalOrder(before).filter((id) => id !== "i"),
    ["p", "a", "b"],
  );
  assert.throws(
    () =>
      c.execute({
        type: "connect",
        edge: edge("bad", "i", "image", "b", "prompt"),
      }),
    /tương thích/,
  );
  assert.throws(
    () =>
      validateGraph({
        ...before,
        edges: [
          edge("ab", "a", "text", "b", "prompt"),
          edge("ba", "b", "text", "a", "prompt"),
        ],
      }),
    /vòng lặp/,
  );
  assert.deepEqual(c.snapshot(), before);
});
test("deleting a node removes references; undo redo restores exact graph", () => {
  const graph = {
    ...emptyGraph(),
    nodes: [node("p", "prompt"), node("a", "generateText")],
    edges: [edge("e", "p", "text", "a", "prompt")],
    groups: [{ id: "g", name: "Luồng", nodeIds: ["p", "a"] }],
  };
  const c = new GraphController(graph);
  c.execute({ type: "deleteNode", id: "p" });
  assert.equal(c.snapshot().edges.length, 0);
  assert.deepEqual(c.snapshot().groups[0].nodeIds, ["a"]);
  assert.deepEqual(c.undo(), graph);
  assert.equal(c.redo().nodes.length, 1);
});
test("exports whitelist data, stripping secrets and live sessions; import gives fresh project identity", () => {
  const p = createProject("Dự án");
  p.secret = "secret";
  p.graph.nodes.push({
    ...node("p", "prompt"),
    data: {
      text: "Hello",
      apiKey: "secret",
      chatTarget: { tabId: 1 },
      cookie: "cookie",
    },
  });
  const text = exportProject(p);
  assert.ok(!text.includes("secret"));
  assert.ok(!text.includes("cookie"));
  assert.ok(!text.includes("chatTarget"));
  const copy = importProject(text);
  assert.notEqual(copy.id, p.id);
  assert.equal(copy.graph.nodes[0].id, "p");
  assert.equal(copy.graph.nodes[0].data.text, "Hello");
});
test("rejects unsupported versions, duplicate IDs and dangling edges", () => {
  assert.throws(
    () => importProject('{"format":"mooz-cvn-project","schemaVersion":2}'),
    /phiên bản/,
  );
  assert.throws(
    () =>
      validateGraph({
        ...emptyGraph(),
        nodes: [node("a", "prompt"), node("a", "prompt")],
      }),
    /trùng ID/,
  );
  assert.throws(
    () =>
      validateGraph({
        ...emptyGraph(),
        edges: [edge("e", "none", "text", "other", "prompt")],
      }),
    /tương thích/,
  );
});
