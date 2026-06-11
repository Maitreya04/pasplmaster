import { notePlaceholder } from '../../lib/picking/pickerMicrocopy';

export interface NoteInputProps {
  value: string;
  onChange: (value: string) => void;
  isOver: boolean;
  isOpen: boolean;
  id?: string;
}

export function NoteInput({
  value,
  onChange,
  isOver,
  isOpen,
  id = 'picker-note',
}: NoteInputProps): React.JSX.Element | null {
  if (!isOpen) return null;

  return (
    <div className="mx-3 mt-2 sm:mx-4">
      <textarea
        id={id}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={notePlaceholder(isOver)}
        className="max-h-20 w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm text-[var(--content-primary)] outline-none focus:border-[var(--role-primary)]"
      />
    </div>
  );
}
