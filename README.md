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
npm run build      # 构建产物（out/）
npm run dist       # 打包 dmg（electron-builder）
npm run test:core  # 断句核心逻辑冒烟测试
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

```
src/
├── shared/            # 主/渲染进程共享
│   ├── types.ts       # 工程结构、设置、IPC 数据类型
│   ├── api.ts         # preload 桥接接口定义
│   └── core/          # 断句核心（纯 TS，可单测）
│       ├── tokens.ts      # whisper json-full → 词级 token（真实时间戳优先，插值兜底）
│       ├── sentence.ts    # 跨段合并成句（句末标点）
│       ├── assemble.ts    # 字幕条组装 + 词边界换行
│       ├── cue.ts         # 播放位置 → 当前字幕（浮点容差）
│       ├── srt.ts         # SRT 导出
│       └── ai.ts          # AI 断句：导出文本 / 粘贴导入逐字校验
├── main/              # Electron 主进程
│   ├── mediaServer.ts # 内嵌 localhost 媒体服务（标准 HTTP Range，seek 稳定）
│   ├── ffmpeg.ts      # 探测 / 抽 wav / 预览转码（进度解析）
│   ├── cssBurn.ts     # CSS 字幕烧录：离屏渲染 PNG + overlay/enable 单次编码
│   ├── whisper.ts     # whisper.cpp CLI 子进程（json-full）
│   ├── projects.ts    # 工程文件 + 最近列表
│   ├── dev/burnHarness.ts # 烧录管线 CLI 验证工具
│   ├── settings.ts    # 设置与缓存目录
│   ├── binaries.ts    # whisper-cli / ffmpeg 自动探测
│   └── ipc.ts         # IPC handlers
└── renderer/          # React 界面
    └── src/components/
        ├── VideoPlayer.tsx    # 播放器 + 字幕预览浮层 + 转码兜底
        ├── SubtitleList.tsx   # 字幕条增删改
        ├── SettingsDialog.tsx # 模型拖入 / 路径 / 断句配置
        ├── AiDialog.tsx       # AI 断句导出 / 粘贴导入
        └── ...
```
