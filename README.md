# Agent增强版

> 关镇江基于开源项目改造。  
> 一个给 Claude Code、Cursor CLI、Codex、Gemini CLI 用的本地 Web UI。  
> 这个版本在原始 `claudecodeui` 基础上，加入了 `Harness + .claude 团队共享系统` 的工作流能力。

---

## 1. 这是什么项目

这是一个本地运行的 Web 应用，用来把命令行 AI 编程工具变成一个更容易操作的图形界面。

你可以把它理解成：

1. 左边是你的项目列表和会话
2. 中间是聊天窗口
3. 旁边还有文件、终端、Git、任务、预览等能力
4. 如果项目里有 `.claude`，还可以进入 `Harness` 流程，按阶段推进 AI 开发任务

这个项目适合两类人：

1. 只想要一个比纯命令行更好用的 AI 编程界面
2. 想把 `.claude` 团队共享系统、PIV 流程、Harness、多阶段验证引入开发流程

---

## 2. 这个版本比原版多了什么

这个仓库当前已经不仅仅是“Claude/Codex/Cursor/Gemini 的聊天界面”，还增加了：

1. `普通对话 / Harness 流程` 双模式
2. 项目根目录 `.claude` 自动识别
3. `HarnessTask`、Pack、Gate、失效传播
4. `.claude` 命令注册中心和阶段状态机
5. Workspace Prime 状态、工件工作台、Timeline
6. `review / validation / human gate`
7. benchmark / eval
8. checkpoint / resume
9. knowledge feedback
10. bootstrap：把无 `.claude` 项目升级成可进入 Harness 的项目

简单说：

- 没有 `.claude` 时，它就是一个好用的 AI 编程 Web UI
- 有 `.claude` 时，它会变成一个带团队工作流治理能力的 AI 开发工作台

---

## 3. 你能用它做什么

### 基础能力

1. 用聊天窗口和 AI 直接对话
2. 查看和恢复历史会话
3. 浏览文件、打开文件、编辑文件
4. 使用内置终端
5. 看 Git 变更、暂存、提交
6. 在桌面和移动端访问同一个本地服务

### Harness / 团队共享系统能力

1. 识别项目根目录下的 `.claude`
2. 根据 `.claude/commands` 自动注册阶段命令
3. 让任务按 `/prim -> /pln -> /exec -> /revu /vald -> /iter ...` 这样的流程走
4. 生成 Pack、运行时工件、Gate 状态
5. 当计划、工件或文件变化时，让旧结论自动失效
6. 用 benchmark 指标量化“是否真的提升了 AI 开发效果”

---

## 4. 先看结论：新手怎么最快跑起来

如果你只想先把项目启动起来，请只看这 6 步：

1. 安装 `Node.js 22+`
2. 克隆这个仓库
3. 在项目根目录执行 `npm ci`
4. 开发模式执行 `npm run dev`
5. 浏览器打开 `http://localhost:3001`
6. 注册一个本地账号，选一个项目路径开始用

如果你只是想运行生产构建版本：

1. `npm ci`
2. `npm run build`
3. `npm run server`
4. 浏览器打开 `http://localhost:3001`

---

## 5. 环境要求

开始前请确保你至少满足下面这些条件：

1. `Node.js 22+`
2. `npm`
3. Windows / macOS / Linux 任意一种
4. 至少安装并能正常使用一种 AI CLI

支持的 AI CLI 方向：

1. Claude Code
2. Cursor CLI
3. Codex
4. Gemini CLI

注意：

1. 这个项目是 UI，不替代你原本的 AI CLI
2. 你仍然需要先让对应 CLI 在本机能正常工作
3. 如果某个 CLI 本身没装好，这个 UI 也无法替你“凭空补齐”

---

## 6. 傻瓜式安装与启动

### 6.1 克隆项目

```bash
git clone https://github.com/UF-gzj/agent-enhanced-ui.git
cd agent-enhanced-ui
```

如果你当前用的是这个改造后的本地仓库，就直接进入项目目录即可。

### 6.2 安装依赖

```bash
npm ci
```

如果你不是做 CI，也可以用：

```bash
npm install
```

推荐优先用 `npm ci`，因为更稳定、可重复。

### 6.3 开发模式启动

```bash
npm run dev
```

这个命令会同时启动：

1. 前端开发服务器
2. 后端开发服务器

启动成功后，打开：

```text
http://localhost:3001
```

### 6.4 生产模式启动

如果你不想跑开发热更新，而是想跑构建后的版本：

```bash
npm run build
npm run server
```

然后打开：

```text
http://localhost:3001
```

### 6.5 第一次启动会发生什么

第一次启动时你通常会看到这些情况：

1. 没有 `.env` 文件也可以启动
2. 程序会自动在用户目录下准备默认数据库
3. 浏览器首次进入会让你注册本地账号
4. 注册完后进入项目列表和聊天界面

默认数据库路径逻辑在：

- [E:\data\claudecodeui-upstream\server\load-env.js](</E:/data/claudecodeui-upstream/server/load-env.js>)

---

## 7. 傻瓜式使用：第一次怎么用

这里按“完全没接触过这个项目的人”来讲。

### 7.1 第一步：打开网页并注册账号

启动后打开：

```text
http://localhost:3001
```

按页面提示注册一个本地账号。

这是本地 Web UI 的登录账号，不是 Claude/Codex/Gemini 的官方账号。

### 7.2 第二步：添加你的项目路径

把你真正要开发的项目目录加进来。

比如：

```text
D:\Desktop\my-project
```

添加后，项目会出现在左侧项目列表。

### 7.3 第三步：系统会自动检查这个项目能不能进 Harness

当你选中项目后，系统会自动检查：

```text
项目根目录下是否存在 .claude 文件夹
```

当前逻辑是：

1. 有 `.claude`：`Harness` 可用
2. 没有 `.claude`：只能普通聊天

注意，这里检查的是：

```text
你选中的项目根目录/.claude
```

不是递归扫描你项目下面所有子目录。

### 7.4 第四步：普通聊天怎么用

如果你只是想直接和 AI 聊天：

1. 选中项目
2. 保持模式为 `普通对话`
3. 在输入框里直接描述需求
4. 回车或点击发送

这时它就是普通 AI 编程对话。

适合：

1. 问代码问题
2. 小改动
3. 查文件
4. 解释逻辑
5. 让 AI 帮你写一小段代码

### 7.5 第五步：Harness 流程怎么开启

如果你的项目根目录下有 `.claude`，聊天区会允许你切到：

```text
Harness 流程
```

切过去以后：

1. 任务会进入 Harness 路径
2. 团队流程命令会按阶段流转
3. 会写运行时工件
4. 会显示当前任务、当前阶段、Gate 状态

### 7.6 第六步：没有 `.claude` 怎么办

如果没有 `.claude`，有两种做法：

1. 继续只用普通聊天
2. 到 `Harness` 工作台里使用 `bootstrap`

`bootstrap` 会帮你把项目升级成一个最小可用的 Harness 项目。

---

## 8. 基础使用手册

### 8.1 聊天窗口

聊天窗口是日常使用最多的地方。

你可以在这里：

1. 发普通自然语言消息
2. 切换 `普通对话 / Harness 流程`
3. 用单次覆盖决定“这条消息临时走普通还是 Harness”
4. 输入 slash command
5. 上传图片

### 8.2 普通对话模式

适合这些场景：

1. 代码解释
2. 方案讨论
3. 小修改
4. 非流程化问题

特点：

1. 不创建 Harness 任务
2. 不生成 Pack
3. 不走 reviewer / validator gate

### 8.3 Harness 流程模式

适合这些场景：

1. 正式开发任务
2. 要按阶段推进的改造
3. 要保留计划、验证、审查痕迹
4. 要降低幻觉和偏差

特点：

1. 会创建任务
2. 会记录阶段
3. 会生成 Pack 和运行时状态
4. 会使用 Gate / 失效机制

### 8.4 文件页

你可以：

1. 浏览项目目录
2. 打开文件
3. 查看和编辑代码

### 8.5 Shell 页

你可以：

1. 直接使用终端
2. 跑构建、测试、脚本
3. 用 AI 配合终端一起工作

### 8.6 Git 页

你可以：

1. 查看变更
2. 暂存文件
3. 提交代码
4. 看最近提交
5. 管理分支

### 8.7 Harness 页

这是这个版本最核心的新增工作台。

你可以看到：

1. 当前任务
2. 当前阶段
3. Workspace 状态
4. Command Registry
5. Timeline
6. Artifact Workbench
7. Gate 详情
8. Benchmark Dashboard
9. Checkpoint / Resume
10. Knowledge Feedback
11. Bootstrap / Template

---

## 9. Harness / `.claude` 工作流怎么理解

### 9.1 先用大白话说

Harness 不是“另一个聊天框”，而是“任务流控制台”。

它解决的是：

1. 任务现在做到哪一步了
2. 该不该进入下一步
3. review 和 validation 结果还算不算有效
4. 当前上下文变了以后，旧结论要不要作废

### 9.2 `.claude` 在这里的作用

`.claude` 是团队共享系统的根目录。

它通常会承载：

1. 规则
2. 命令
3. 参考知识
4. 计划、报告、审查、RCA 等工件

当前项目会在你选中项目后，自动检查项目根目录下有没有 `.claude`。

### 9.3 常见阶段命令

如果你的 `.claude` 里有对应命令，常见流程会像这样：

```text
/prim -> /pln -> /exec -> /revu /vald -> /iter
```

也就是：

1. `prim`：先对齐上下文
2. `pln`：形成计划
3. `exec`：执行
4. `revu`：审查
5. `vald`：验证
6. `iter`：针对失败或问题继续迭代

### 9.4 什么时候会失效

如果这些东西变了：

1. 计划
2. 代码
3. 关键工件
4. 当前阶段输入

那么旧的 review / validation 结果会被标成过期或失效。

这就是 Harness 的“失效传播”。

---

## 10. 高级进阶：把它当正式 AI 开发工作台用

如果你已经不满足于“聊聊天”，可以看这一节。

### 10.1 配置 Claude Code 子 agent 模型

当前设置页支持 4 个 provider：

1. Claude Code
2. Cursor
3. Codex
4. Gemini

但当前版本里，只有：

```text
Claude Code
```

支持 reviewer / validator 子模型配置。

也就是说：

1. 选 `Claude Code`：可以给 reviewer / validator 选模型
2. 选 `Cursor / Codex / Gemini`：会显示 `不支持`

### 10.2 用 Harness 做正式任务

推荐流程：

1. 选中有 `.claude` 的项目
2. 切到 `Harness 流程`
3. 先走 `/prim`
4. 再走 `/pln`
5. 然后 `/exec`
6. 看 `revu / vald / human gate`
7. 如果失败，走 `/iter`

### 10.3 用 Artifact Workbench 看正式工件

在 Harness 面板中，你可以看：

1. 哪些工件被当前任务绑定
2. 工件当前状态是否新鲜
3. 刷新工件后任务是否被自动失效

### 10.4 用 Timeline 回看全过程

Timeline 能让你知道：

1. 哪个阶段何时执行
2. 谁回写了什么状态
3. 哪次验证失败
4. 哪次失效发生了

### 10.5 用 Benchmark Dashboard 看量化结果

如果你已经做到了第三期能力，这里可以：

1. 创建 benchmark dataset
2. 运行 baseline 与 harness 对比
3. 看 `M19 ~ M27`
4. 看是否达到 claim gate

### 10.6 用 Checkpoint / Resume 做长任务恢复

适合：

1. 长任务中断
2. 需要回到某个稳定点
3. 想在不同阶段保存任务快照

### 10.7 用 Knowledge Feedback 做知识回流

它的作用不是“记聊天记录”，而是：

1. 把这次任务里被证明有价值的经验写下来
2. 以后让类似任务复用
3. 但不直接污染正式真相层

### 10.8 用 Bootstrap 初始化新项目

如果一个新项目没有 `.claude`：

1. 先添加项目路径
2. 打开 Harness 面板
3. 执行 `bootstrap`
4. 项目会获得最小可用的 `.claude` 结构
5. 然后就可以进入 Harness

---

## 11. 开发者怎么跑测试

### 11.1 类型检查

```bash
npm run typecheck
```

### 11.2 一期浏览器自动化

```bash
$env:CLOUDCLI_E2E_HARNESS_PROJECT_PATH='E:\\data\\claudecodeui-upstream\\tests\\e2e\\fixtures\\harness-workspace'
npm run test:e2e:harness-phase1
```

### 11.3 二期浏览器自动化

```bash
npm run test:e2e:harness-phase2
```

### 11.4 三期浏览器自动化

```bash
npm run test:e2e:harness-phase3
```

### 11.5 三期 summary 自动化

```bash
npm run test:e2e:harness-phase3-summary
```

### 11.6 生产构建

```bash
npm run build
```

---

## 12. 常见问题排查

### 12.1 页面打不开

先检查：

1. 终端里服务是不是已经启动
2. 端口 `3001` 是否被占用
3. 浏览器打开的是不是 `http://localhost:3001`

### 12.2 为什么项目不能进入 Harness

最常见原因：

1. 你选中的项目根目录下没有 `.claude`
2. `.claude` 不在项目根目录，而是在子目录
3. 当前项目路径不对

### 12.3 为什么只能普通聊天

因为当前项目被判定为：

```text
unavailable_no_claude
```

解决办法：

1. 换一个根目录下已有 `.claude` 的项目
2. 或者使用 bootstrap

### 12.4 为什么看不到历史任务

先检查：

1. 你是不是选中了正确项目
2. 当前项目是否真的进入过 Harness
3. 当前任务是否已经写入运行时工件

### 12.5 为什么 review / validation 结果失效了

通常是因为：

1. 代码变了
2. 工件变了
3. 计划变了
4. 你手动触发了失效

这不是 bug，而是 Harness 的正常保护机制。

### 12.6 为什么 build 里还有 warning

当前仓库还保留一些既有的非阻塞 warning，例如：

1. CSS minify warning
2. chunk size warning
3. Playwright 启动服务时的 `DEP0190` warning

这些不会阻塞项目运行，但后续可以继续优化。

---

## 13. 推荐使用姿势

如果你是第一次接触，推荐这样用：

### 轻量模式

1. 启动项目
2. 添加项目路径
3. 先用普通聊天
4. 熟悉文件、终端、Git 页面

### 正式开发模式

1. 给项目准备 `.claude`
2. 打开 Harness
3. 按阶段推进任务
4. 使用 Gate、Artifact、Timeline

### 团队治理模式

1. 统一 `.claude` 结构
2. 用 command registry 管理流程命令
3. 用 benchmark 跟踪收益
4. 用 knowledge feedback 做长期回流

---

## 14. 目录说明

项目里你最常接触的目录通常是：

```text
src/                     前端代码
server/                  后端代码
tests/e2e/               浏览器自动化
public/                  静态资源
dist/                    前端构建产物
dist-server/             后端构建产物
```

Harness 相关代码主要在：

```text
server/harness/
src/components/harness/
```

---

## 15. 最后给第一次使用者的建议

如果你是第一次接触这个项目，不要一上来就想把所有高级能力都用上。

最稳的顺序是：

1. 先把项目跑起来
2. 先用普通聊天
3. 再确认 `.claude` 自动识别是否正常
4. 再切 Harness
5. 再看 Pack、Gate、Artifact、Timeline
6. 最后再用 benchmark、checkpoint、knowledge feedback

这样最不容易乱，也最容易定位问题。

---

## 16. License

本项目遵循：

```text
AGPL-3.0-or-later
```

详情见：

- [E:\data\claudecodeui-upstream\LICENSE](</E:/data/claudecodeui-upstream/LICENSE>)

---

## 17. 致谢

这个项目建立在以下能力和生态之上：

1. Claude Code
2. Cursor CLI
3. Codex
4. Gemini CLI
5. React
6. Vite
7. Tailwind CSS
8. CodeMirror

---

如果你只记住一句话，可以记这句：

**没有 `.claude` 时，它是一个好用的 AI 编程 Web UI；有 `.claude` 时，它会升级成一个带 Harness 工作流治理能力的 AI 开发工作台。**
