// media 播放地址：内嵌 localhost 静态服务（标准 HTTP Range，seek 稳定）。
// 旧实现为自定义 protocol:// + Node 流转发，因 seek 竞态触发解码错误已弃用。
import { startMediaServer, mediaServerUrl, stopMediaServer } from './mediaServer'

export { startMediaServer, mediaServerUrl, stopMediaServer }
