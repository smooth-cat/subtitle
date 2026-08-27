import type { ReactNode } from 'react'

export default function Modal({
  title,
  onClose,
  children,
  wide
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`modal ${wide ? 'modal-wide' : ''}`}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="btn ghost" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
