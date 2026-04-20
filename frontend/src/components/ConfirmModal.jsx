import Modal from './Modal'

export default function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-gray-400 mb-6">{message}</p>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            danger
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
          }`}
        >
          {confirmLabel}
        </button>
        <button
          onClick={onClose}
          className="flex-1 py-2 rounded-lg text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </Modal>
  )
}
