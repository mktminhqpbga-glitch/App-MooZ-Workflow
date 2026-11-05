// Reference tokens bind to immutable asset IDs; display numbers can be reordered.
export function promptAssetIds(text = '') {
  return [...new Set([...text.matchAll(/@\{asset:([a-zA-Z0-9_-]{1,100})\}/g)].map(match => match[1]))];
}
export function nodeAssetIds(node) {
  return [...new Set([
    node.data.assetId,
    ...(node.data.resultAssets ? JSON.parse(node.data.resultAssets) : []),
    ...promptAssetIds(node.data.studioPrompt),
  ].filter(Boolean))];
}
export function remapPromptAssets(text = '', map) {
  return text.replace(/@\{asset:([a-zA-Z0-9_-]{1,100})\}/g, (_, id) => {
    if (!map.has(id)) throw Error('Bản sao lưu thiếu ảnh tham chiếu trong prompt.');
    return `@{asset:${map.get(id)}}`;
  });
}
