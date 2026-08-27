/* eslint-disable no-console */
// 核心断句逻辑冒烟测试：npm run test:core
import {
  parseWhisperJson,
  rawToTokens,
  buildSentences,
  assembleCues,
  wrapText,
  cuesToSrt,
  buildAiExport,
  parseAiImport,
  findActiveCue
} from '../src/shared/core'
import { DEFAULT_ASSEMBLE, type Cue, type RawSegment } from '../src/shared/types'

let failed = 0
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✔ ${name}`)
  } else {
    failed++
    console.error(`  ✘ ${name}`, detail ?? '')
  }
}

// ─── 模拟 whisper json-full（粗分段，如中文：无空格 → 需要插值兜底）───
const coarseJson = {
  result: { language: 'zh' },
  transcription: [
    {
      offsets: { from: 0, to: 3200 },
      text: '大家好，今天我们聊一聊字幕工具的设计思路。'
    },
    {
      offsets: { from: 3200, to: 6100 },
      text: '这个想法其实很简单，先把句子拼完整，再决定在哪里换行！'
    },
    {
      offsets: { from: 6100, to: 8000 },
      text: '最后用词级时间戳生成时间轴'
    }
  ]
}

// ─── 词级分段（-ml 1 -sow 生效时：每段一个词）─────────────────────
const fineJson = {
  result: { language: 'zh' },
  transcription: [
    { offsets: { from: 0, to: 400 }, text: '你' },
    { offsets: { from: 400, to: 800 }, text: '好' },
    { offsets: { from: 800, to: 1000 }, text: '。' },
    { offsets: { from: 1000, to: 1600 }, text: '天' },
    { offsets: { from: 1600, to: 2200 }, text: '气' },
    { offsets: { from: 2200, to: 2800 }, text: '不' },
    { offsets: { from: 2800, to: 3400 }, text: '错' },
    { offsets: { from: 3400, to: 3600 }, text: '。' }
  ]
}

console.log('── tokens ──')
const coarseRaw = parseWhisperJson(coarseJson)
check('解析分段数', coarseRaw.length === 3)
const coarseTokens = rawToTokens(coarseRaw)
check('粗分段插值出多 token', coarseTokens.length > 10, coarseTokens.length)
check('token 文本保持原文', coarseTokens.map((t) => t.text).join('') === coarseRaw.map((r) => r.text).join(''))
check('token 时间单调', coarseTokens.every((t, i) => i === 0 || t.start >= coarseTokens[i - 1].start))

const fineRaw = parseWhisperJson(fineJson)
const fineTokens = rawToTokens(fineRaw)
check('词级分段保持 token 数', fineTokens.length === 8, fineTokens.length)
check('词级使用真实时间戳', fineTokens[3].start === 1000 && fineTokens[3].end === 1600)

// token 内部句末标点切分
const splitTokens = rawToTokens([{ text: '好。那我们', start: 0, end: 1000 }])
check(
  'token 内标点切分',
  splitTokens.length >= 2 && splitTokens[0].text === '好。' && splitTokens.map((t) => t.text).join('') === '好。那我们',
  splitTokens
)

console.log('── sentences ──')
const sentences = buildSentences(coarseTokens)
check('句末标点处结束句子（3 段 → 3 句，末句无标点兜底）', sentences.length === 3, sentences.map((s) => s.text))
check(
  '句子跨越 whisper segment',
  sentences[1].text.startsWith('这个想法') && sentences[1].text.includes('换行！'),
  sentences[1].text
)
check('有标点的句子以句末标点结尾', sentences.slice(0, 2).every((s) => /[。！？!?…]$/.test(s.text.trim())))
check(
  '句子文本不丢字',
  sentences.map((s) => s.text).join('') === coarseRaw.map((r) => r.text).join('')
)

console.log('── assemble ──')
const cfg = { ...DEFAULT_ASSEMBLE }
const drafts = assembleCues(sentences, cfg)
check('每句一条字幕', drafts.length === 3, drafts.map((d) => d.text))
const dur0 = sentences[0].end - sentences[0].start
check(
  '句尾缓冲 +1s 且不超过下一句开始',
  drafts[0].end === Math.min(sentences[0].start + dur0 + cfg.endBufferMs, drafts[1].start - 20),
  { got: drafts[0].end, start: sentences[0].start, dur0, next: drafts[1].start }
)

// 超长句拆分
const longText =
  '这是一段特别长的测试文本，用来验证超长句子能否在词边界处被正确拆分成多条字幕，同时保证断点落在标点之后或者最接近中点的词边界上，不会把词语从中间硬生生切断。'
const longSentences = buildSentences(rawToTokens([{ text: longText, start: 10000, end: 40000 }]))
const longDrafts = assembleCues(longSentences, cfg)
check('超长句被拆分', longDrafts.length > 1, longDrafts.length)
check(
  '拆分文本不丢字',
  longDrafts.map((d) => d.text.replace(/\n/g, '')).join('') === longText,
  longDrafts.map((d) => d.text)
)
check(
  '拆分时间单调衔接',
  longDrafts.every((d, i) => i === 0 || d.start >= longDrafts[i - 1].start)
)
check(
  '单条不超时（含 20% 容差）',
  longDrafts.every((d) => d.end - d.start <= cfg.maxCueDurationMs * 1.21),
  longDrafts.map((d) => d.end - d.start)
)

console.log('── wrap ──')
const lines = wrapText('今天天气非常好啊，我们一起出去玩吧！', cfg)
check('2 行时换行', lines.length === 2, lines)
check('优先二级标点断行', lines.length === 2 && lines[0].endsWith('，'), lines)
check('整词不截断', lines.join('|') === '今天天气非常好啊，|我们一起出去玩吧！', lines)

console.log('── srt ──')
const srt = cuesToSrt(
  drafts.map((d, i) => ({
    id: `c${i}`,
    text: d.text,
    start: d.start,
    end: d.end,
    tokenStart: d.tokenStart,
    tokenEnd: d.tokenEnd,
    source: 'local' as const
  }))
)
check('SRT 含时间轴', srt.includes(' --> ') && srt.includes('00:00:0'))
check('SRT 时间格式', /\d{2}:\d{2}:\d{2},\d{3}/.test(srt))

console.log('── AI 导出 / 导入 ──')
const aiRaw: RawSegment[] = [
  { text: ' 大家好，今天天气不错', start: 0, end: 3000 },
  { text: ' 我们出去走走吧', start: 3000, end: 5600 },
  { text: ' 好啊，走！', start: 5600, end: 7600 }
]
const aiTokens = rawToTokens(aiRaw)
const exp = buildAiExport(aiRaw)
check('导出带 #序号', exp.fileText.includes('#1 大家好，今天天气不错'), exp.fileText)
check('提示词包含禁改文字要求', exp.prompt.includes('不得改动、增删、翻译任何文字'))

// AI 正确断句（每行一句，去掉行号）
const aiOk = '#1 大家好，今天天气不错\n#2 我们出去走走吧\n#3 好啊，走！'
  .split('\n')
  .map((l) => l.replace(/^#\d+\s*/, ''))
  .join('\n')
const okResult = parseAiImport(aiOk, aiRaw, aiTokens, cfg)
check('一致文本校验通过', okResult.ok, okResult.ok ? '' : okResult.message)
if (okResult.ok) {
  check('一条 AI 行一条字幕', okResult.cues.length === 3, okResult.cues.map((c) => c.text))
  check('时间轴来自词级时间戳', okResult.cues[0].start === 0, okResult.cues[0])
  check('末句结束时间 = 句尾 + 缓冲', okResult.cues[2].end === 7600 + cfg.endBufferMs, okResult.cues[2])
}

// AI 改了文字 → 拒绝
const bad = parseAiImport('大家好，今天天气很好\n我们出去走走吧\n好啊，走！', aiRaw, aiTokens, cfg)
check('改动文字被拒绝', !bad.ok, bad.ok ? '应该失败' : bad.message)
check('报错包含差异上下文', !bad.ok && bad.diff !== null)

// AI 断在词组内部 → 吸附到词边界（“天气”中间断开 → 吸附）
const inside = parseAiImport('大家好，今天天\n气不错\n我们出去走走吧\n好啊，走！', aiRaw, aiTokens, cfg)
check('词内断点仍通过校验', inside.ok, inside.ok ? '' : inside.message)
if (inside.ok) {
  check('吸附时有提示', inside.warnings.some((w) => w.includes('吸附')), inside.warnings)
  check(
    '吸附后文字完整',
    inside.cues.map((c) => c.text.replace(/\s/g, '')).join('') === '大家好，今天天气不错我们出去走走吧好啊，走！',
    inside.cues.map((c) => c.text)
  )
}

console.log('── active cue（浮点容差）──')
const mkCue = (id: string, start: number, end: number): Cue => ({
  id,
  text: id,
  start,
  end,
  tokenStart: -1,
  tokenEnd: -1,
  source: 'manual'
})
const activeCues = [mkCue('a', 56182, 64562), mkCue('b', 64582, 72412), mkCue('c', 72432, 80460)]
// 复现浮点误差：64582/1000*1000 = 64581.99999999999
check('seek 落点浮点误差仍命中字幕', findActiveCue(activeCues, (64582 / 1000) * 1000)?.id === 'b')
// start 端 60ms 容差会桥接 20ms 的条间空隙：下一条提前亮起，避免 seek 到帧量化落点时字幕空窗
check('间隙内桥接显示下一条（防空窗）', findActiveCue(activeCues, 64570)?.id === 'b')
check('正常区间命中', findActiveCue(activeCues, 70000)?.id === 'b')
check('时间轴之外为空', findActiveCue(activeCues, 999999) === null)
check('前一条未结束前仍显示前一条', findActiveCue(activeCues, 64552)?.id === 'a')

console.log(failed === 0 ? '\n全部通过 ✔' : `\n${failed} 项失败 ✘`)
process.exit(failed === 0 ? 0 : 1)
