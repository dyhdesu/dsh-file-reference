# dsh-file-reference

侧栏「工作区文件」树**右键**一键引用：把文件/文件夹以原生 `@路径` 引用 chip 插进当前会话输入框。

DeepSeek Harness 的侧栏文件树只有**左键**一个手势（点文件=打开预览、点目录=展开），想引用某个文件只能手打 `@` 再一层层找。本插件给树上补上**右键**：引用一步到位，走的是宿主自己的引用通道。

## 效果

在右侧栏「工作区文件」面板里，**右键**任意文件或文件夹行：

| 菜单项 | 行为 |
|---|---|
| **引用到会话** | 把该条目以 `@路径` chip 插入当前会话输入框——与把文件拖进输入框**同一条宿主通道**，插入的是真正的引用 chip，发送时宿主按文件引用解析 |
| **复制引用文本** | 把 `@路径` 文本写入剪贴板 |

- 路径自动折算成相对当前会话工作区的相对路径；含空格的路径自动加引号（`@"my dir/readme.md"`）；目录尾随 `/`。
- 插入成功自动聚焦输入框；会话未挂载、正在发送或输入框拒绝插入时**给出提示**，不静默失败。
- 菜单样式全取宿主主题令牌，亮暗主题跟随；点击别处、Esc、滚动、窗口失焦自动关闭。
- 中英双语，跟随宿主语言。

## 安装

### 方式一 · 插件页添加（桌面版用户）

DSH 桌面版：打开侧边栏**插件**页 → **添加插件** → 粘贴下面一行 → 装完点**启用** → 按提示重启或刷新。

```
dsh-file-reference
```

或直接粘贴 GitHub 地址：

```
https://github.com/dyhdesu/dsh-file-reference
```

### 方式二 · 命令行（web / headless profile）

```
dsh plugin --profile web add dsh-file-reference
```

装完重启 `dsh web`，浏览器硬刷新。

从源码仓库安装（npm 未发布时用这条）：

```
dsh plugin --profile web add github:dyhdesu/dsh-file-reference
```

### 方式三 · 本地目录接线（开发用）

`desktop` profile 由 Electron 应用独占管理，官方 CLI 会拒绝直接写入（`profile "desktop" is managed exclusively by the Electron application`）。自己开发时走手动接线：

```sh
cd ~/.dsh/profiles/desktop
```

在该目录的 `package.json` 里，`dependencies` 增加一条指向本目录的 `file:` 依赖，并在 `dsh.profile.bundles` 里追加 `"dsh-file-reference"`；然后在同目录执行安装并重启桌面版。

```
pnpm install
```

改完源码后同步安装副本，client 半区刷新页面即生效：

```
rsync -a --delete src/ ~/.dsh/profiles/desktop/node_modules/dsh-file-reference/src/
```

## 原理

- 官方文件树（`@deepseek-ai/dsh-client-ui-sidebar-files`）的每个行节点带 `data-files-entry="file|directory"` 与 `data-files-path="绝对路径"`，树根带 `data-files-root`；插件在**捕获阶段**监听 `contextmenu` 命中这些行——官方树本身没有任何右键处理，这块手势是空的。
- 插入走宿主 `conversation` 服务的 `input.shell(sessionId).addFiles([reference], [])`，即 `SessionInputShell.addFiles`——官方给引用 chip 留的程序化入口（内部走 `draftEditor.insertFileReferences`）；chip 形态 `{source:'reference', ref, label, appearance, clipboardText}` 与官方 `@` 菜单、拖文件进输入框**完全一致**，不是自造协议。
- 当前会话由 `uiSession.current.value.key` 提供；多会话时按文件树根路径与会话 `cwd` 比对纠偏，避免把引用插进别的会话。
- 与官方 `@` 引用语义对齐：引用只携带**路径**，不读取也不附带文件内容（官方 `dsh-file-reference` 明确规定「选中候选绝不读取或附带文件内容」），模型要看内容必须自己调文件系统工具。
- **纯前端插件**：host 半区为空操作（`export function apply() {}`），不碰宿主源码、不注册路由、不改配置，装卸无残留；HMR 重评估时先拆上一代句柄（监听器、菜单、代际槽）。

## 兼容性

- 在 **DSH 0.2.1-rc.2**（macOS 桌面版）上开发与验证。
- 依赖官方文件树的行属性契约（`data-files-entry` / `data-files-path` / `data-files-root`）与 `SessionInputShell.addFiles`。官方若改动这两处，插件需要跟进；已做降级：服务缺失或结构不匹配时不抛异常、不静默失败。
- 输入框中的引用 chip 形态与官方 `@` 菜单、拖拽入文件一致，因此引用在草稿恢复、跨工作区切换等场景下与官方行为一致。

## 已知局限

- 一次只处理单行：暂不支持多选批量引用。
- 只接管侧栏文件树的行；消息区已渲染的引用 chip 不在此插件的右键范围内。
- 目录引用只插入 `@目录/`，不展开目录内容（官方 `@` 菜单的 Tab 下钻能力未复刻）。
- 引用 chip 插入需要会话已挂载且输入框可编辑；发送中会被宿主拒绝并提示。

## 开发与测试

```sh
npm test
```

25 项用例覆盖：路径归一化与 `@` 语法（含空格引号、目录尾斜杠、控制字符拒绝）、chip 载荷构造、会话归属判定、菜单生命周期与拆卸、服务全缺时的降级，以及 `src/client.js` 内联逻辑段与 `src/logic.mjs` 的**逐字同源校验**（防止两侧逻辑漂移）。

## 许可

MIT © 2026 dyhdesu
