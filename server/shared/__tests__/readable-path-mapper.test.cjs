const test = require("node:test");
const assert = require("node:assert");
const {
  sanitizeNamePart,
  buildPathMap,
  toLogicalPath,
  toPhysicalPath,
  getDownloadFileName
} = require("../readable-path-mapper.cjs");

test("sanitizeNamePart 清理非法文件名字符，保留中文", () => {
  assert.equal(sanitizeNamePart("安装/指南: v1.0?"), "安装-指南- v1.0");
  assert.equal(sanitizeNamePart(""), "未命名");
  assert.equal(sanitizeNamePart(null), "未命名");
});

test("buildPathMap 生成分类+标题+版本的可读路径", () => {
  const docs = [
    {
      sourcePath: "知识库/wiki/articles/ops/article-123/abc123.md",
      title: "安装指南",
      arch_category: "运维",
      version: "v1.0"
    }
  ];
  const map = buildPathMap(docs);
  assert.equal(map.logicalPaths[0], "运维/安装指南-v1.0.md");
  assert.equal(
    toLogicalPath(docs[0].sourcePath, map),
    "运维/安装指南-v1.0.md"
  );
  assert.equal(
    toPhysicalPath("运维/安装指南-v1.0.md", map),
    docs[0].sourcePath
  );
});

test("重名文档自动加序号，不覆盖，双向映射一一对应", () => {
  const docs = [
    { sourcePath: "a/1/hash1.md", title: "说明", arch_category: "文档" },
    { sourcePath: "a/2/hash2.md", title: "说明", arch_category: "文档" }
  ];
  const map = buildPathMap(docs);
  assert.equal(map.logicalPaths.length, 2);
  assert.equal(map.logicalPaths[0], "文档/说明.md");
  assert.equal(map.logicalPaths[1], "文档/说明-1.md");
  assert.notEqual(
    toPhysicalPath(map.logicalPaths[0], map),
    toPhysicalPath(map.logicalPaths[1], map)
  );
});

test("缺分类/缺版本自动兜底，不报错", () => {
  const docs = [{ sourcePath: "x/hash.md", title: "空分类文档" }];
  const map = buildPathMap(docs);
  assert.equal(map.logicalPaths[0], "未分类/空分类文档.md");
});

test("getDownloadFileName 提取最后一段可读文件名", () => {
  assert.equal(getDownloadFileName("运维/安装/指南-v1.md"), "指南-v1.md");
  assert.equal(getDownloadFileName(""), "文档.md");
});

test("重复构建结果完全一致，纯函数无副作用", () => {
  const docs = [
    { sourcePath: "p1", title: "A", arch_category: "C" },
    { sourcePath: "p2", title: "B", arch_category: "C" }
  ];
  const map1 = buildPathMap(docs);
  const map2 = buildPathMap(docs);
  assert.deepEqual(map1.logicalPaths, map2.logicalPaths);
});

test("找不到映射时回退原路径，不抛错", () => {
  const map = buildPathMap([]);
  assert.equal(toLogicalPath("unknown/path", map), "unknown/path");
  assert.equal(toPhysicalPath("unknown/logical", map), "unknown/logical");
});
