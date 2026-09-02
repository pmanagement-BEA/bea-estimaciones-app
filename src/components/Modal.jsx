export default function Modal({ title, body, confirmText = 'Confirmar', onConfirm, onClose }) {
  return (
    <div className="modal-overlay show" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">{title}</div>
        <div className="modal-body" dangerouslySetInnerHTML={{ __html: body }} />
        <div className="modal-actions">
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => { onConfirm(); onClose() }}>{confirmText}</button>
        </div>
      </div>
    </div>
  )
}
