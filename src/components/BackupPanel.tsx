import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { downloadTextFile } from '../lib/download'
import { backupFileName, BackupError, exportBackup, parseBackup, restoreBackup } from '../lib/backup'

/**
 * Your data lives only in this browser on this device. A backup file moves it between devices and addresses (a new
 * address, such as the online copy of the app, starts empty) and protects against clearing the browser's data.
 */
export default function BackupPanel() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [pending, setPending] = useState<ReturnType<typeof parseBackup> | null>(null)

  const save = async () => {
    downloadTextFile(backupFileName(), JSON.stringify(await exportBackup()), 'application/json')
    setMessage({ kind: 'ok', text: 'Backup saved to your downloads.' })
  }

  const choose = async (file: File | undefined) => {
    setPending(null)
    if (!file) return
    try {
      setPending(parseBackup(await file.text()))
      setMessage(null)
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof BackupError ? e.message : 'That file could not be read.' })
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const restore = async () => {
    if (!pending) return
    try {
      const done = await restoreBackup(pending)
      setMessage({ kind: 'ok', text: `Restored ${done.recipes} recipes and ${done.pantryItems} pantry items.` })
    } catch {
      setMessage({ kind: 'error', text: 'The restore failed, so nothing was changed.' })
    }
    setPending(null)
  }

  return (
    <>
      <div className="block-head">
        <h2>Your data</h2>
        <p>Everything is stored on this device only. Save a backup before you clear your browser, change phone, or open the app at a new address.</p>
      </div>
      <div className="filters">
        <button type="button" onClick={save}>
          <Download size={18} aria-hidden /> Save a backup
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          <Upload size={18} aria-hidden /> Restore from a backup
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="Backup file" onChange={(e) => choose(e.target.files?.[0])} />
      </div>
      {pending && (
        <div className="notice" role="alertdialog" aria-label="Confirm restore">
          <p>
            This backup has {pending.tables.recipes.length} recipes and {pending.tables.pantryItems.length} pantry items, saved on{' '}
            {pending.exportedAt.slice(0, 10)}. Restoring <strong>replaces everything</strong> on this device.
          </p>
          <div className="filters">
            <button type="button" className="on" onClick={restore}>
              Replace everything
            </button>
            <button type="button" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && (
        <p className={message.kind === 'error' ? 'empty' : 'hint'} role="status">
          {message.text}
        </p>
      )}
    </>
  )
}
