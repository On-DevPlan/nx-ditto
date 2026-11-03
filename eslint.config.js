// ESLint 扁平配置。
//
// 这里主要管的不是代码风格（那个交给约定与编辑器），而是**分层约束**：
// 把「谁可以依赖谁」写成机器可检查的规则。架构意图一旦只写在文档里，
// 就会随提交次数慢慢衰减；写成 lint 规则则会当场拦下。
import { defineConfig } from 'eslint/config';
import react from 'eslint-plugin-react';

// 单文件字符数闸门。
//
// 与 BASE_RULES 里的 max-lines 是同一件事的两把尺子：行数管「结构」，字符数管「密度」。
// 只看行数时，把每行拉长就能继续膨胀；只看字符数时，密集短行又会被误伤。
// 两者都按「有效代码」计（跳过空行与注释），阈值 15000 对当前最大文件
// （scripts/link-local.mjs，约 12.7k 有效字符）留出余量：再翻一倍就该拆了。
//
// 注意这条闸门**不跟着 max-lines 给 scripts/ 与 tools/ 开豁免**：
// 行数豁免的本意是「开发脚本结构随意」，不是「体积可以无上限」。详见文件末尾。
//
// ESLint 没有内置的「单文件字符数」规则，这里用一份内联插件补上，
// 免得为一个阈值去引第三方插件或额外文件。
const FILE_SIZE = {
  rules: {
    'max-file-chars': {
      meta: {
        type: 'suggestion',
        docs: { description: '单个文件的有效字符数上限，防止文件体积膨胀' },
        schema: [
          {
            type: 'object',
            properties: { max: { type: 'integer', minimum: 1 } },
            additionalProperties: false,
          },
        ],
      },
      create(context) {
        const max = (context.options[0] && context.options[0].max) || 15000;
        return {
          Program(node) {
            const source = context.sourceCode || context.getSourceCode();
            let text = source.getText();
            // 注释区间整段剔除：比正则可靠，不会误伤字符串里的 `//`
            for (const comment of [...source.getAllComments()].reverse()) {
              text = text.slice(0, comment.range[0]) + text.slice(comment.range[1]);
            }
            const count = text.replace(/\s/g, '').length;
            if (count > max) {
              // 消息用字符串拼接，**不要**用 ESLint 的 messages/messageId 插值：
              // 那套语法是「双花括号 + 变量名」，而本文件是模板文件，模板引擎
              // 同样把双花括号当生成变量，生成项目时直接报「未声明的变量」。
              // 连这段注释里都不能出现双花括号，否则生成期一样会红。
              context.report({
                node,
                message: `单文件有效字符数 ${count} 超过上限 ${max}，请按职责拆分文件。`,
              });
            }
          },
        };
      },
    },
  },
};

// 操作成对闸门：一条 action 要么同时有 CLI 与 HTTP，要么显式承认只做 CLI。
//
// 运行时注册表已经在装载期拦「没有 CLI 的 action」，但那是启动后才失败；
// 而且「http: null」一直是个无声出口——写了纯 CLI 命令没人知道是有意还是漏了。
// 这条规则把判决提前到编辑器/lint：http: null 必须二选一——
//   a) 属于豁免前缀（serve / server / skill，这些天然是 CLI 侧能力），或
//   b) 显式写 web: false，表明「这个操作就是不给面板入口」。
// 反向也管：同时声明 http 与 web: false 是语义冲突，当场报错。
//
// 规则扫的是 action 对象字面量（以 id 字符串为锚点，兼容 JS 的 run 写法和
// TS 的 defineAction 两段式写法），不是运行时值——所以它不需要跑起来。
const ACTION_PARITY = {
  rules: {
    'action-parity': {
      meta: {
        type: 'problem',
        docs: {
          description: 'action 必须同时声明 CLI 与 HTTP；纯 CLI 需显式 web: false 或属于豁免前缀',
        },
        schema: [
          {
            type: 'object',
            properties: { cliOnlyPrefixes: { type: 'array', items: { type: 'string' } } },
            additionalProperties: false,
          },
        ],
      },
      create(context) {
        const opts = context.options[0] || {};
        // 豁免名单同时也是 runtime/registry 的常量；两处必须一致（有单测对账）
        const prefixes = opts.cliOnlyPrefixes || ['serve', 'server', 'skill'];

        // 读对象里的字面量属性（只认 Identifier / Literal 键，不碰计算属性）
        const propOf = (obj, name) =>
          obj.properties.find(
            (p) =>
              !p.computed &&
              ((p.key.type === 'Identifier' && p.key.name === name) ||
                (p.key.type === 'Literal' && p.key.value === name))
          );
        const literalString = (node) =>
          node && node.type === 'Literal' && typeof node.value === 'string' ? node.value : null;

        // CLI 可能写成 ['a','b']，也可能写成 [[别名路径], ['另一条路径']]
        function firstCliSegment(cliProp) {
          if (!cliProp || cliProp.value.type !== 'ArrayExpression') return null;
          const first = cliProp.value.elements[0];
          if (!first) return null;
          if (first.type === 'Literal') return literalString(first);
          if (first.type === 'ArrayExpression') return literalString(first.elements[0]);
          return null;
        }

        return {
          ObjectExpression(node) {
            const idProp = propOf(node, 'id');
            const id = idProp ? literalString(idProp.value) : null;
            if (!id) return;

            const cliProp = propOf(node, 'cli');
            const httpProp = propOf(node, 'http');
            const webProp = propOf(node, 'web');
            const runProp = propOf(node, 'run');

            // 只认 action 字面量：模块对象（id + actions）不满足下面任一特征
            if (!runProp && !cliProp && !httpProp) return;

            const report = (n, message) => context.report({ node: n || node, message });

            if (
              !cliProp ||
              cliProp.value.type !== 'ArrayExpression' ||
              cliProp.value.elements.length === 0
            ) {
              report(cliProp || idProp, `action ${id} 必须声明非空 cli（Web 操作必须有 CLI 等价命令）`);
            }

            if (!httpProp) {
              report(idProp, `action ${id} 必须声明 http 路由；纯 CLI 请写 http: null 并标注 web: false`);
              return;
            }

            const httpValue = httpProp.value;
            const isNull = httpValue.type === 'Literal' && httpValue.value === null;
            const webFalse =
              webProp && webProp.value.type === 'Literal' && webProp.value.value === false;

            if (isNull) {
              const segment = firstCliSegment(cliProp);
              const exempt = segment && prefixes.includes(segment);
              if (!exempt && !webFalse) {
                report(
                  httpProp,
                  `action ${id} 声明了 http: null，但既不在豁免前缀（${prefixes.join(' / ')}）内，也没有显式 web: false——CLI 与 Web 必须成对`
                );
              }
              return;
            }

            if (httpValue.type === 'ArrayExpression') {
              if (
                httpValue.elements.length !== 2 ||
                !literalString(httpValue.elements[0]) ||
                !literalString(httpValue.elements[1])
              ) {
                report(httpProp, `action ${id} 的 http 必须是 [method, path] 两个字面量`);
              }
              if (webFalse) {
                report(webProp, `action ${id} 同时声明了 http 与 web: false，语义冲突`);
              }
            }
          },
        };
      },
    },
  },
};

// 两个内联插件合并成一个，避免同一个文件被两个 plugins 块重复声明。
const LOCAL_RULES = { rules: { ...FILE_SIZE.rules, ...ACTION_PARITY.rules } };

const BASE_RULES = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-undef': 'off', // 浏览器/Node 全局混用，靠运行时暴露；装 globals 包不值得
  eqeqeq: ['error', 'smart'],
  'prefer-const': 'error',
  'no-var': 'error',
  'no-console': 'off', // CLI 工具，输出就是产品
  // 文件行数上限：防止单文件持续膨胀，超限应先拆分
  'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
};

export default defineConfig([
  { ignores: ['src/web/public/**', 'node_modules/**', 'templates/**'] },
  {
    files: ['**/*.{js,mjs,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: BASE_RULES,
  },

  // JSX：基础 ESLint 的 no-unused-vars 不把 JSX 标签算作变量使用
  // （TS 模板由 typescript-eslint 处理）。jsx-uses-vars 是标记规则，
  // 让只在 JSX 中出现的组件/变量不被误报为未使用。
  {
    files: ['**/*.jsx'],
    plugins: { react },
    rules: { 'react/jsx-uses-vars': 'error' },
  },

  // 字符数闸门：覆盖所有被 lint 的文件，**不**给 scripts/ 与 tools/ 开豁免 ——
  // 下面那条 max-lines 豁免管的是「结构」，体积上限是产品约束，两者不是一回事。
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    plugins: { local: LOCAL_RULES },
    rules: { 'local/max-file-chars': ['error', { max: 15000 }] },
  },

  // ---- 分层约束（对应主文档「依赖只能向下 core ← modules ← runtime」）----

  {
    // core 是最底层：零业务语义的基础设施。它一旦依赖上层，分层就塌了。
    files: ['src/core/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../modules/**', '../runtime/**', '../web/**',
                '../../modules/**', '../../runtime/**', '../../web/**',
              ],
              message: 'core 是最底层，不得依赖 modules / runtime / web。',
            },
          ],
        },
      ],
    },
  },

  {
    // 模块之间禁止互相值依赖，需要共享的下沉到 core/。
    //
    // 逐模块枚举（与 nx-nx / TS 模板一致）：新增模块时把它的路径补进
    // files 与 group。枚举式规则的已知风险是「漏补静默」——靠
    // tests/unit 的注册表一致性断言兜底。
    files: ['src/modules/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../home/*', '../home/**', '../skill/*', '../skill/**', '../settings/*', '../settings/**', '../clip/*', '../clip/**'],
              message: '模块之间不得互相依赖；共享逻辑请下沉到 core/。',
            },
          ],
        },
      ],
    },
  },

  {
    // 前端：这条规则的价值最高——把 Node 侧代码 import 进视图，
    // Vite 会把 node: 内置模块一起打进浏览器包，构建期报错或运行期炸掉。
    files: [
      'src/web/frontend/**/*.{js,jsx}',
      // 模块里的视图也要盖住：只写 web/frontend 的话，真正写视图的
      // modules/<域>/view.jsx 反而不受「前端别导 node:」这条规则约束（规则形同虚设）
      'src/modules/**/*.jsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: '前端不能引用 Node 内置模块。',
            },
            {
              group: ['**/modules/*/index.js', '**/modules/*/service.js', '**/runtime/**', '**/core/**'],
              message:
                '前端只能 import 模块的 view.jsx。index.js/service.js/runtime/core 是 Node 侧代码，拖进浏览器包会把 node: 内置模块一起带进来。',
            },
          ],
        },
      ],
    },
  },

  // ---- 生成器专属区域：tools/ 要读模板树、写目标目录、spawn 进程 ----
  { files: ['tools/**/*.{js,mjs}'], rules: { 'no-restricted-imports': 'off' } },

  // 开发/生成器脚本与工具：不强制行数上限（src 内的产品代码才强制）。
  // 只豁免行数——上面的字符数闸门仍然生效，所以这里不要顺手把 max-file-chars 也关掉。
  {
    files: ['scripts/**/*.{js,mjs}', 'tools/**/*.{js,mjs}'],
    rules: { 'max-lines': 'off' },
  },

  // 操作成对：每条 action 必须同时有 CLI 与 HTTP（纯 CLI 走豁免前缀或 web: false）。
  // 放在分层规则之后：registry.test.mjs 用正则从本文件里抓「模块互依禁列」块，
  // 这一块的 files 也含 src/modules/，排前面会被误抓。
  {
    files: ['src/modules/*/index.js'],
    plugins: { local: LOCAL_RULES },
    rules: {
      'local/action-parity': ['error', { cliOnlyPrefixes: ['serve', 'server', 'skill'] }],
    },
  },
]);
