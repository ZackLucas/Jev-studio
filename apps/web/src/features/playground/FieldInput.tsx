import type { Candidate, FieldDef, FieldValue } from '@jev/core';

interface Props {
  field: FieldDef;
  value: FieldValue | undefined;
  error?: string;
  onChange: (value: FieldValue) => void;
}

/** One form control per FieldKind — the UI is generated from the preset. */
export function FieldInput({ field, value, error, onChange }: Props) {
  const id = `f-${field.key}`;
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id} className="field-label">
        {field.label}
        {field.required && <span className="req">*</span>}
        <code className="field-key">{field.key}</code>
      </label>
      <Control id={id} field={field} value={value} onChange={onChange} />
      {field.help && <div className="field-help">{field.help}</div>}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

function Control({ id, field, value, onChange }: Omit<Props, 'error'> & { id: string }) {
  switch (field.kind) {
    case 'text':
      return (
        <input id={id} className="input" value={(value as string) ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      );
    case 'textarea':
      return (
        <textarea id={id} className="input" rows={2} value={(value as string) ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      );
    case 'enum': {
      const listId = `${id}-options`;
      return (
        <div className="enum">
          <input id={id} className="input" list={listId} value={(value as string) ?? ''} placeholder="(opcional)" onChange={(e) => onChange(e.target.value)} />
          <datalist id={listId}>
            {field.options?.map((o) => <option key={o} value={o} />)}
          </datalist>
          <div className="chips">
            {field.options?.map((o) => (
              <button type="button" key={o} className={`chip${value === o ? ' is-on' : ''}`} onClick={() => onChange(value === o ? '' : o)}>
                {o}
              </button>
            ))}
          </div>
        </div>
      );
    }
    case 'json':
      return (
        <textarea id={id} className="input mono" rows={10} spellCheck={false} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      );
    case 'state':
      return (
        <textarea
          id={id}
          className="input mono"
          rows={6}
          spellCheck={false}
          placeholder='Texto livre, ou JSON: { "customer_message": "..." }'
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'list':
      return <ListControl id={id} placeholder={field.placeholder} items={(value as string[]) ?? []} onChange={onChange} />;
    case 'candidates':
      return <CandidatesControl items={(value as Candidate[]) ?? []} onChange={onChange} />;
  }
}

function ListControl({ id, items, placeholder, onChange }: { id: string; items: string[]; placeholder?: string; onChange: (v: string[]) => void }) {
  const rows = items.length ? items : [''];
  const set = (i: number, v: string) => onChange(rows.map((x, j) => (j === i ? v : x)));
  return (
    <div className="list">
      {rows.map((item, i) => (
        <div className="list-row" key={i}>
          <input
            id={i === 0 ? id : undefined}
            className="input"
            value={item}
            placeholder={placeholder}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                onChange([...rows.slice(0, i + 1), '', ...rows.slice(i + 1)]);
                requestAnimationFrame(() => {
                  const inputs = (e.target as HTMLElement).closest('.list')?.querySelectorAll('input');
                  (inputs?.[i + 1] as HTMLInputElement | undefined)?.focus();
                });
              }
            }}
          />
          <button type="button" className="icon-btn" title="Remover" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...rows, ''])}>
        + adicionar
      </button>
    </div>
  );
}

function CandidatesControl({ items, onChange }: { items: Candidate[]; onChange: (v: Candidate[]) => void }) {
  const blank: Candidate = { id: '', description: '', extra: '' };
  const rows = items.length ? items : [blank, blank];
  const set = (i: number, patch: Partial<Candidate>) => onChange(rows.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="list">
      {rows.map((c, i) => (
        <div className="candidate" key={i}>
          <input className="input" placeholder="id" value={c.id} onChange={(e) => set(i, { id: e.target.value })} />
          <input className="input" placeholder="descrição" value={c.description} onChange={(e) => set(i, { description: e.target.value })} />
          <input className="input mono" placeholder='extra: {"cost":"low"}' value={c.extra} onChange={(e) => set(i, { extra: e.target.value })} />
          <button type="button" className="icon-btn" title="Remover" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...rows, blank])}>
        + candidato
      </button>
    </div>
  );
}
