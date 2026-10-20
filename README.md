# dsh-image-lite

DSH 生图插件支持**双模式生图**：

- **对话模式**：直接和对话模型说"画一张…"，模型调用 `image_generate_lite` 工具
  把图生出来；说"改这张 / 参考刚才那张"时自动带参考图，支持链式图生图。
- **工作台模式**：在侧边栏「生图工作台」里手动处理生图任务——挑参考图、换模型与
  比例、写描述、出图后继续迭代，全程不占对话轮次。

两种模式共用同一份模型库与快速配置（插件入口 `image-gen-lite`，volatile 热生效），
自包含、无外部依赖，密钥经 DSH 核心凭据服务解析。

> 目标运行时 DSH ≥ 0.1.6（`configForms` 生效），实测 0.2.1-rc.2。

## 两种生图模式

### 一、对话模式：让大模型直接生图

在任意会话里说"画一张/出个图/来张 16:9 的"，对话模型会自动调用
`image_generate_lite`：

- 不带参考图 → 文生图；
- 说"把这张改成…/参考刚才那张" → 带 `referenceImages` 图生图；
- 结果文本内嵌 refs JSON，下一轮可以继续"用这张继续"，链式迭代不断档。

### 二、工作台模式：侧边栏「生图工作台」

会话 header 的「生图」角标（或右栏引导卡片）打开右栏 tab：

- 参考图：本会话最近结果「用这张继续」/ 上传 / 粘贴（经 attachment admission）；
- 换模型、选比例——**实时调整**，写入同一入口，热生效；
- 描述 → 生成 → 结果图库 + 灯箱 → 选中结果继续迭代；
- 右上角红色「清空」一键复位参考图、描述与结果。

### 共用配置：插件页 → dsh-image-lite → 插件配置（`plugins.bundle.config` 卡片）

- **模型库**：增删改供应商/模型（name / baseUrl / 接口格式 / 密钥环境变量 /
  模型列表，每行 `id` 或 `id  显示名`）。
- **快速配置**：默认模型 + 默认图片规格（7 档比例 + auto），
  下一次 `image_generate_lite` 调用即生效。
- **图片存放位置**：留空即 `<会话工作区>/generate/image`，也可填绝对路径，
  并可用「打开文件夹」调用系统选择器。
- **侧边栏 · 在侧边栏中使用生图工作台**（开关，默认开）：关闭立即隐藏
  右栏「生图工作」标签、它的引导卡片与会话 header 的「生图」按钮
  （`image_generate_lite` 工具不受影响）；重新开启后刷新窗口即恢复。

**这些设置存在哪里**

| 内容 | 存放位置 |
| --- | --- |
| 模型库（供应商、模型列表）、默认模型、默认图片规格、图片存放位置、侧边栏开关 | DSH profile 配置里的插件入口 `image-gen-lite`（本机实测落盘为 `~/.dsh/profiles/<profile>/cordis.patch.yml` 的 `image-gen-lite` 段，volatile 热生效） |
| API 密钥 | DSH 凭据服务，按环境变量名索引（本机实测为 `~/.dsh/.credentials.yaml`，权限由 DSH 管理）；插件配置里只留变量名与掩码，如 `IMAGE_GEN_AGNES_API_KEY` / `sk-m****0RPD` |
| 生成的图片 | `<会话工作区>/generate/image/`，或你在「图片存放位置」里指定的目录 |

也就是说：**换台机器只要带上 profile 配置与凭据存储，模型库和密钥就跟着走**；这两处都不在本插件目录里，卸载插件不会删掉它们。

## 工作原理

![工作原理](docs/how-it-works.svg)

两种入口共用同一条链路，插件本体只做四件事：**读设置 → 换密钥 → 发一次请求 → 把图存下来**。

1. **入口**：对话模式由对话模型调用工具 `image_generate_lite`；工作台模式由客户端通过
   本地 RPC（挂在 DSH 现有 web server 的 `/image-gen-lite/*` 前缀下，受 DSH 自身登录令牌保护）
   请求同一套逻辑。
2. **读设置**：从插件入口 `image-gen-lite` 取供应商 `baseUrl`、`apiFormat`、默认模型与图片规格、
   输出目录、侧边栏开关；这些值存在 profile 配置里，改完下一次调用即生效（volatile）。
3. **换密钥**：配置里只有环境变量名（如 `IMAGE_GEN_AGNES_API_KEY`）和掩码，
   真正的密钥由 DSH 凭据服务按名字解析，插件进程里不落明文、不写日志。
4. **发请求**：按 openai-images 约定向 `{baseUrl}/images/generations` 发一次 HTTPS；
   图生图时把参考图内联成 `image` data URL 放在同一个请求里（本机实测该供应商只支持这种写法）。
5. **取回并落盘**：响应里的 `b64_json` 直接解码，或者按返回的 `url` 下载一次；
   随后 `mkdir -p` 输出目录并写文件，再登记进会话附件——所以下一轮能"用这张继续"。

## 权限与文件边界

| 类别 | 具体行为 |
| --- | --- |
| **读** | ① 插件入口 `image-gen-lite` 的配置；② 你在会话里显式传入的参考图附件（`attachments.readImage`，只认传进来的图）；③ 已生成的图片文件——**路径白名单**：仅 `<会话工作区>/generate/image` 与你在插件页「图片存放位置」里填的目录，越界一律报 `path is not a generated image file` |
| **写** | ① 图片：`mkdir -p` 输出目录后写 `lite-image-<时间戳>-<随机>.png`（按实际 MIME 取扩展名）；② 配置：经 DSH 配置表单写 profile 里的插件入口（本机实测落盘为 `~/.dsh/profiles/<profile>/cordis.patch.yml` 的 `image-gen-lite` 段）；③ 密钥：经 DSH 凭据服务写入（本机为 `~/.dsh/.credentials.yaml`），插件配置里只保留 `sk-m****0RPD` 这样的掩码 |
| **网络** | 只有两个出口：你配置的供应商 `baseUrl`（如 `https://api.agnes-ai.cn/v1`），以及供应商返回结果图的那个 URL（通常同域名）。没有遥测、没有第三方上报、不访问其它站点、不新开监听端口 |
| **不做** | 不执行 shell 命令、不遍历或上传工作区其它文件、不改 DSH 源码、不安装额外依赖（`package.json` 里除 DSH 自带包外无 runtime 依赖）、不常驻后台任务 |

一句话：**只读你显式给它的图，只写你指定的目录，只连你配置的域名。**

> 卸载插件不会删除已生成的图片与已存进凭据服务的密钥；要彻底清理，删除
> profile 配置里的 `image-gen-lite` 段、凭据里的对应环境变量名，以及你指定的输出目录。

## 安装

```powershell
# 从 DSH 桌面端 CLI / 插件页安装本地包（link: 方式）：
dsh plugin --profile desktop add link:D:\path\to\dsh-image-lite
```

重启 DSH（或 HMR 生效时自动重组合）后：

1. 插件页 → dsh-image-lite：添加供应商/模型、粘贴密钥，选默认模型与规格；
2. **对话模式**：在会话里说"画一张…"即自动调用 `image_generate_lite`；
3. **工作台模式**：会话 header 出现「生图」角标，点开即右栏「生图工作」tab
   （插件页该卡片里的「侧边栏」开关可把它连同角标一起关掉）。

密钥直接在 插件页 → dsh-image-lite 的供应商卡片里粘贴（存进 DSH 凭据服务，配置里只留环境变量名与掩码，如 `IMAGE_GEN_AGNES_API_KEY` / `sk-0****7890`）。

## 开发

```bash
node test/wire.test.js        # 纯函数单测（比例映射/回退、wire 体、refs 校验）
node test/client-wiring.test.js  # client 接线 + 模型库纯函数
```

包结构、接口约定与风险清单见仓库根 `PLAN.md`；实施记录见 `.superpowers/progress.md`。
