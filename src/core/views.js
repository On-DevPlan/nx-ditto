// 「有哪些页面」的**单一来源**：纯数据、零 import。
//
// 为什么放 core 而不是前端注册表：这份清单两端都要读——
//   - 前端（web/frontend/registry.js）按 id 拼出懒加载组件，渲染头部导航
//   - 后端（modules/home）按 id 校验「导航分组 / 隐藏 / 平铺顺序」配置，坏 id 当场报错
// 放 core 且不 import 任何东西，两边都能安全引用。
//
// 新增一个页面 = 写 modules/<域>/view.jsx + 这里加一行 + registry.js 的 COMPONENTS 加一行。
// tests/unit/registry.test.mjs 把「清单 ↔ 组件 ↔ 模块目录」钉在一起对账。

export const VIEWS_META = [
  { id: 'home', title: '首页', order: 10 },
  { id: 'clip', title: '剪贴板', order: 20 },
];

export function viewMetaOf(id) {
  return VIEWS_META.find((v) => v.id === id) || null;
}

export function viewIdsOf() {
  return VIEWS_META.map((v) => v.id);
}
