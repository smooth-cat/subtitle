# Subtitle Studio · 视频字幕工具

本地视频字幕工具：whisper.cpp 转写 → 智能断句 → 手动增删改 → SRT 导出 / 硬字幕烧录。

## 功能（MVP）

- **视频加载**：h264 直播；h265 等无法硬解的格式自动用 ffmpeg 转出 h264 预览副本兜底
- **语音转文字**：whisper.cpp CLI 子进程（json-full 输出 + `-ml 1 -sow`），拿到词级时间戳；分段过粗时按字符占比插值兜底
- **断句**：
  - 跨段合并成句：累积 token 直到句末标点（。？！?!…），句子允许跨越多个 whisper segment
  - 词边界切分：`Intl.Segmenter`（Electron 自带 ICU，零额外依赖）
  - 一句一条；超长句在词边界拆分（优先二级标点 ，、；： 之后，否则取最接近中点的词边界）
  - 断点时间取真实词级时间戳；字幕条结束 = 句尾 + 1s 缓冲，不超过下一句开始
- **换行**：单条最多 2 行、每行 ≤16 字（可配置）；换行点必须落在词边界，优先二级标点
- **手动编辑**：字幕条纯增删改（新增 / 编辑文本 / 修改时间 / 删除）
- **字幕样式（CSS）**：在右侧「字幕样式」Tab 中以 CSS 设计字幕外观（自动保存，合法即生效）（作用对象 `.cue-overlay` / `.cue-line`，变量 `--vh`/`--vw` 为视频内容高宽），默认白字+圆角黑色半透明板；**预览与烧录使用同一份 CSS**，所见即所得
- **烧录原理**：Electron 离屏窗口按视频原始分辨率逐条渲染字幕（DOM+CSS，透明 PNG，内容 bbox 裁剪）→ ffmpeg N 个 `overlay + enable=between(t,start,end)`（毫秒级精确时间窗，单次编码）
- **导出**：SRT；硬字幕烧录（上述 CSS 管线），完成后自动在 Finder 中显示
- **工程文件**：JSON 保存全部词级时间戳与断句元数据，由应用数据目录统一管理，支持最近打开列表、自动保存（⌘S 手动保存）
- **AI 断句兜底**：导出待断句文本（`#序号 文本`，支持时间段分块导出）+ 一键复制提示词模板；粘贴回结果后逐字校验（不一致拒绝并高亮差异），断点偏移映射回词边界（词内断点自动吸附并提示），再用词级时间戳重建时间轴

## 环境要求

### 运行打包后的应用（dmg）

| 项目 | 要求 |
| --- | --- |
| 芯片 | **Apple Silicon**（M1 / M2 / M3 / M4 系列） |
| macOS | **≥ 12.0 Monterey**（Electron 41 最低系统要求） |
| 内存 | 建议 ≥ 16GB（large-v3-turbo 转写推理 + 4K 视频转码/烧录；8GB 机型可用但偏紧） |
| 外部依赖 | `brew install ffmpeg whisper-cpp`（运行时自动探测，见「构建与打包」） |

- 当前 dmg 为 **arm64 单架构**构建，不含 Intel 版本，Intel Mac 无法运行；如需支持可另行配置 x64 / universal 打包
- 转写走 whisper.cpp 的 Metal GPU 加速，仅 Apple Silicon 可用

### 开发 / 构建

| 依赖 | 说明 |
| --- | --- |
| Node.js ≥ 20 | 开发 / 构建 |
| ffmpeg（含 ffprobe） | `brew install ffmpeg`；音频抽取、预览转码、字幕烧录 |
| whisper.cpp | `brew install whisper-cpp`（提供 `whisper-cli`），或自行编译后到「设置」指定路径 |
| large-v3-turbo 模型 | 自行下载 gguf 文件（约 1.6GB），不随应用打包 |

模型下载（任选其一，下载后拖入应用即可）：

- https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-large-v3-turbo.bin
- https://hf-mirror.com/ggerganov/whisper.cpp/blob/main/ggml-large-v3-turbo.bin （镜像）

## 开发

```bash
npm install
npm run dev        # 启动开发模式
npm run typecheck  # 类型检查
npm run test:core  # 断句核心逻辑冒烟测试
```

## 构建与打包

| 命令 | 作用 |
| --- | --- |
| `npm run build` | 编译 src → `out/`（main / preload / renderer 三段 + dev 烧录工具） |
| `npm run dist` | 完整打包：`electron-vite build` + `electron-builder` → dmg |

打包链路：`npm run dist` 先由 electron-vite 把 `src/` 编译进 `out/`，再由 electron-builder 将 `out/` 连同 Electron 41 运行时组装成 `Subtitle Studio.app` 并生成磁盘镜像。

- **产物**：`release/Subtitle Studio-<版本>-arm64.dmg`（Apple Silicon；`release/mac-arm64/` 下同时有解包的 `.app`）
- **打包配置**：`package.json` 的 `build` 字段（appId、目标、图标等）
- **应用图标**：`resources/icon.png`（1000×1000 源图入库，打包时 electron-builder 自动转换为 icns）
- **签名**：`mac.identity: null`，跳过 Apple 签名，本机自用可直接运行；若要分发他人需自行签名 + 公证
- **运行时依赖不打包**：安装包只含 Electron 与应用代码，ffmpeg / whisper-cli / 模型文件在运行时自动探测（设置中指定路径 → PATH → `/opt/homebrew/bin` 等常见位置），目标机器需先安装 `brew install ffmpeg whisper-cpp`

常用变体：

```bash
npx electron-builder            # 未改代码，仅重新生成 dmg
rm -rf out release && npm run dist   # 干净重建
```

## 使用流程

1. **置入模型**：下载 large-v3-turbo gguf 后直接拖进窗口（或「设置 → 模型」），状态变为「已置入」
2. **打开视频**：拖入视频或点「打开视频」（应用数据目录自动建工程；有历史工程则载入）
3. **转写**：点「转写」，等待进度完成，自动生成断好句的字幕条
4. **微调**：在右侧列表直接编辑文本 / 时间，可新增、删除；对断句不满意可调「设置 → 断句」后点「重新断句」；或用「AI 断句」导入人工断句结果
5. **导出**：`导出 SRT` 或 `烧录合成`（ffmpeg 硬字幕烧录，完成后自动在 Finder 中显示）

数据目录：`~/Library/Application Support/subtitle-studio/`（`projects/` 工程文件、`settings.json`、`recent.json`、`cache/` 音频与预览转码缓存）

## 性能与 GPU 加速

- **转写**：whisper.cpp（brew 版内置 **Metal GPU** 加速），large-v3-turbo 在 Apple Silicon 上实时率远高于 1x
- **视频编码（预览转码 / 烧录）**：使用 **x264 多线程**。实测（M1 Pro / ffmpeg 9）端到端快于 VideoToolbox 硬编——硬编的提交模型有 ~3.3x 实时吞吐上限，且超 4K 分辨率（如 4112×2568 录屏）直接超出硬件编码器支持范围；x264 多线程解码/滤镜/编码全并行，速度与质量均最优

## 架构

electron-vite 三段构建：`main`（主进程，CJS bundle）/ `preload`（桥接脚本）/ `renderer`（React 静态资源），统一输出到 `out/`，共享代码经 `@shared` 别名引用。

## 项目结构

```
.
├── resources/
│   └── icon.png                   # 应用图标源图（打包时自动转换为 icns，随仓库分发）
├── electron.vite.config.ts        # 三段构建配置与路径别名（@shared、@）
├── package.json                   # 依赖、npm scripts、electron-builder 配置（"build" 字段）
├── tsconfig.json
├── plans/                         # 开发规划文档（mvp.md）
├── scripts/
│   └── test-core.ts               # 断句核心逻辑冒烟测试（npm run test:core）
├── out/                           # electron-vite 编译产物（不入库）
│   ├── main/                      #   主进程 bundle
│   ├── preload/                   #   预加载 bundle
│   ├── renderer/                  #   渲染进程静态资源
│   └── harness/                   #   dev-only 烧录验证工具（不进安装包）
├── release/                       # 打包产物（不入库）
│   ├── mac-arm64/Subtitle Studio.app
│   └── Subtitle Studio-<版本>-arm64.dmg
└── src/
    ├── shared/                    # 主/渲染进程共享
    │   ├── types.ts               #   工程结构、设置、IPC 数据类型
    │   ├── api.ts                 #   preload 桥接接口定义
    │   ├── subtitleStyle.ts       #   字幕 CSS 单一来源（预览 = 烧录，所见即所得）
    │   └── core/                  #   断句核心（纯 TS，可单测）
    │       ├── index.ts           #     barrel 出口
    │       ├── text.ts            #     标点集合 / 全半角字符宽度
    │       ├── segmenter.ts       #     Intl.Segmenter 词边界切分（标点/空白吸附）
    │       ├── tokens.ts          #     whisper json-full → 词级 token（真实时间戳优先，插值兜底）
    │       ├── sentence.ts        #     跨段合并成句（句末标点）
    │       ├── assemble.ts        #     字幕条组装 + 词边界换行
    │       ├── cue.ts             #     播放位置 → 当前字幕（浮点容差）
    │       ├── srt.ts             #     SRT 导出
    │       └── ai.ts              #     AI 断句：导出文本 / 粘贴导入逐字校验
    ├── main/                      # Electron 主进程
    │   ├── index.ts               #   入口：窗口、应用菜单
    │   ├── mediaServer.ts         #   内嵌 localhost 媒体服务（标准 HTTP Range，seek 稳定）
    │   ├── protocol.ts            #   media:// 播放地址 → 内嵌媒体服务
    │   ├── ffmpeg.ts              #   探测 / 抽 wav / 预览转码（进度解析）
    │   ├── cssBurn.ts             #   CSS 字幕烧录：离屏渲染 PNG + overlay/enable 单次编码
    │   ├── whisper.ts             #   whisper.cpp CLI 子进程（json-full）
    │   ├── jobs.ts                #   子进程任务管理（进度事件、取消）
    │   ├── projects.ts            #   工程文件 + 最近列表
    │   ├── settings.ts            #   设置与缓存目录
    │   ├── binaries.ts            #   whisper-cli / ffmpeg 自动探测
    │   ├── ipc.ts                 #   IPC handlers
    │   └── dev/burnHarness.ts     #   烧录管线 CLI 验证工具
    └── renderer/                  # React 界面
        ├── index.html
        └── src/
            ├── main.tsx           #   React 入口
            ├── App.tsx            #   应用骨架、拖拽、状态编排
            ├── lib.ts             #   window.api 封装、时间格式化等工具
            ├── styles.css         #   全局样式
            ├── env.d.ts           #   类型声明
            └── components/
                ├── Toolbar.tsx            # 顶部工具栏（打开 / 转写 / 导出 / 最近列表）
                ├── VideoPlayer.tsx        # 播放器 + 字幕预览浮层 + 转码兜底
                ├── SidePane.tsx           # 右侧栏（字幕列表 / 字幕样式 Tab）
                ├── SubtitleList.tsx       # 字幕条增删改
                ├── StylePreviewStage.tsx  # 字幕样式预览舞台（iframe 隔离草稿 CSS）
                ├── StatusBar.tsx          # 底部任务进度条（可取消）
                ├── SettingsDialog.tsx     # 模型拖入 / 路径 / 断句配置
                ├── AiDialog.tsx           # AI 断句导出 / 粘贴导入
                ├── TimeInput.tsx          # 时间码输入框
                └── Modal.tsx              # 通用弹窗容器
```
