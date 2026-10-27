import { useEffect, useRef } from 'react';

let locks = 0;
let previousOverflow = '';

export default function Dialog({ open, onClose, className = '', label, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open) { if (dialog.open) dialog.close(); return; }
    if (!dialog.open) dialog.showModal();
    if (locks++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    return () => {
      if (dialog.open) dialog.close();
      if (--locks === 0) document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  return <dialog ref={ref} className={className} aria-label={label} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>{children}</dialog>;
}
