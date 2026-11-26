'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Tags, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/modal';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { createTag, deleteTag, listTags, tagsQueryKey, updateTag } from './api';
import { TAG_COLORS, TAG_NAME_MAX_LENGTH, TAGS_PER_ITEM_LIMIT, parseTagFilterValue, tagColorClass, type Tag, type TagColor, type TagSummary } from './types';
import { useUiText } from '@/components/ui/use-ui-text';

const colorLabels: Record<TagColor, string> = {
  gray: 'Cinzento',
  blue: 'Azul',
  green: 'Verde',
  amber: 'Âmbar',
  red: 'Vermelho',
  purple: 'Roxo',
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível guardar as etiquetas.';
}

/** Site tag catalogue, shared by every tags control on the page. */
export function useSiteTags(siteId: string | null | undefined) {
  return useQuery({
    queryKey: tagsQueryKey(siteId),
    queryFn: () => listTags(siteId as string),
    enabled: Boolean(siteId),
    staleTime: 30_000,
  });
}

export function TagChips({ tags, limit, className = '' }: { tags?: TagSummary[]; limit?: number; className?: string }) {
  if (!tags?.length) return null;
  const shown = limit ? tags.slice(0, limit) : tags;
  const hidden = tags.length - shown.length;
  return (
    <span className={`tag-chips${className ? ` ${className}` : ''}`} aria-label="Etiquetas">
      {shown.map((tag) => (
        <span key={tag.id} className={`tag-chip tag-chip--${tagColorClass(tag.color)}`} title={tag.name}>{tag.name}</span>
      ))}
      {hidden > 0 ? <span className="tag-chip tag-chip--more" title={tags.slice(shown.length).map((tag) => tag.name).join(', ')}>+{hidden}</span> : null}
    </span>
  );
}

export interface TagFilterProps {
  siteId: string | null | undefined;
  /** Comma list of tag ids; the select edits the first one. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function TagFilter({ siteId, value, onChange, className = '' }: TagFilterProps) {
  const { data: tags = [] } = useSiteTags(siteId);
  const current = parseTagFilterValue(value)[0] ?? '';
  const known = !current || tags.some((tag) => tag.id === current);
  if (!siteId) return null;
  return (
    <select className={`tag-filter${className ? ` ${className}` : ''}`} aria-label="Filtrar por etiqueta" title="Filtrar por etiqueta" value={current} onChange={(event) => onChange(event.target.value)}>
      <option value="">Todas as etiquetas</option>
      {!known ? <option value={current}>Etiqueta removida</option> : null}
      {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
    </select>
  );
}

/** Name of the tag behind a filter value, for "Filtros aplicados" labels. */
export function useTagFilterLabel(siteId: string | null | undefined, value: string) {
  const { data: tags = [] } = useSiteTags(siteId);
  const ids = parseTagFilterValue(value);
  if (!ids.length) return '';
  return ids.map((id) => tags.find((tag) => tag.id === id)?.name ?? '…').join(' + ');
}

function ColorSelect({ value, onChange, label }: { value: TagColor; onChange: (color: TagColor) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as TagColor)}>
      {TAG_COLORS.map((color) => <option key={color} value={color}>{colorLabels[color]}</option>)}
    </select>
  );
}

function NewTagForm({ siteId, onCreated }: { siteId: string; onCreated?: (tag: Tag) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [color, setColor] = useState<TagColor>('gray');
  const mutation = useMutation({
    mutationFn: () => createTag({ siteId, name: name.trim(), color }),
    onSuccess: (tag) => {
      setName('');
      void queryClient.invalidateQueries({ queryKey: tagsQueryKey(siteId) });
      onCreated?.(tag);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (name.trim()) mutation.mutate();
  };
  return (
    <form className="tag-new-form" onSubmit={submit}>
      <input aria-label="Nome da nova etiqueta" placeholder="Nova etiqueta" maxLength={TAG_NAME_MAX_LENGTH} value={name} onChange={(event) => setName(event.target.value)} />
      <ColorSelect value={color} onChange={setColor} label="Cor da nova etiqueta" />
      <button type="submit" className="secondary-button" disabled={!name.trim() || mutation.isPending}><Plus size={13} /> Criar</button>
      {mutation.isError ? <p className="form-error" role="alert">{errorText(mutation.error)}</p> : null}
    </form>
  );
}

export interface TagEditorProps {
  siteId: string;
  /** Name of the device or subnet, shown in the heading. */
  itemLabel: string;
  selected: TagSummary[];
  save: (tagIds: string[]) => Promise<unknown>;
  close: () => void;
  /** Show the inline "new tag" form; only for the catalog roles (ADMIN, SYSTEMS_OPERATOR). */
  canCreate?: boolean;
}

/** Pick the tags of one device or subnet; new tags can be created inline. */
export function TagEditor({ siteId, itemLabel, selected, save, close, canCreate = false }: TagEditorProps) {
  const { data: tags = [], isLoading } = useSiteTags(siteId);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(selected.map((tag) => tag.id)));
  const mutation = useMutation({ mutationFn: () => save([...chosen]), onSuccess: () => close() });
  const toggle = (id: string) => setChosen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else if (next.size < TAGS_PER_ITEM_LIMIT) next.add(id);
    return next;
  });
  return (
    <Modal title={`Etiquetas · ${itemLabel}`} close={close}>
      <div className="modal-form tag-editor">
        {isLoading ? <p className="panel-description">A carregar etiquetas…</p> : null}
        {!isLoading && !tags.length ? <p className="panel-description">{canCreate ? 'Este site ainda não tem etiquetas. Cria a primeira abaixo.' : 'Este site ainda não tem etiquetas. Um administrador pode criá-las.'}</p> : null}
        {tags.length ? (
          <fieldset className="tag-editor-options" aria-label="Etiquetas do site">
            {tags.map((tag) => (
              <label key={tag.id} className="tag-editor-option">
                <input type="checkbox" checked={chosen.has(tag.id)} onChange={() => toggle(tag.id)} />
                <span className={`tag-chip tag-chip--${tagColorClass(tag.color)}`}>{tag.name}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {canCreate ? <NewTagForm siteId={siteId} onCreated={(tag) => setChosen((current) => (current.size < TAGS_PER_ITEM_LIMIT ? new Set(current).add(tag.id) : current))} /> : null}
        {mutation.isError ? <p className="form-error" role="alert">{errorText(mutation.error)}</p> : null}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={close}>Cancelar</button>
          <button type="button" className="primary-button" disabled={mutation.isPending} onClick={() => mutation.mutate()}>Guardar etiquetas</button>
        </div>
      </div>
    </Modal>
  );
}

function TagManagerRow({ tag, siteId, onChanged }: { tag: Tag; siteId: string; onChanged: () => void }) {
  const ui = useUiText();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<TagColor>(tagColorClass(tag.color));
  const dirty = name.trim() !== tag.name || color !== tagColorClass(tag.color);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: tagsQueryKey(siteId) });
    onChanged();
  };
  const save = useMutation({ mutationFn: () => updateTag(tag.id, { name: name.trim(), color }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => deleteTag(tag.id), onSuccess: refresh });
  const askRemove = async () => {
    const uses = tag.deviceCount + tag.subnetCount;
    const message = uses ? `Eliminar a etiqueta "${tag.name}"? Sai de ${uses} itens.` : `Eliminar a etiqueta "${tag.name}"?`;
    if (await confirm({ message, destructive: true })) remove.mutate();
  };
  const error = save.error ?? remove.error;
  return (
    <li className="tag-manager-row">
      <input aria-label="Nome da etiqueta" maxLength={TAG_NAME_MAX_LENGTH} value={name} onChange={(event) => setName(event.target.value)} />
      <ColorSelect value={color} onChange={setColor} label="Cor da etiqueta" />
      <small className="tag-manager-uses" title="Equipamentos · Sub-redes">{tag.deviceCount} · {tag.subnetCount}</small>
      <button type="button" className="secondary-button" disabled={!dirty || !name.trim() || save.isPending} onClick={() => save.mutate()}>Guardar</button>
      <button type="button" className="icon-button subtle" aria-label={ui('tags.deleteNamed', undefined, { name: tag.name })} disabled={remove.isPending} onClick={() => void askRemove()}><Trash2 size={14} /></button>
      {error ? <p className="form-error" role="alert">{errorText(error)}</p> : null}
      {confirmDialog}
    </li>
  );
}

function TagReadOnlyRow({ tag }: { tag: Tag }) {
  return (
    <li className="tag-manager-row">
      <span className={`tag-chip tag-chip--${tagColorClass(tag.color)}`}>{tag.name}</span>
      <small className="tag-manager-uses" title="Equipamentos · Sub-redes">{tag.deviceCount} · {tag.subnetCount}</small>
    </li>
  );
}

/** Rename, recolour and delete the site's tags; without `canManage` it only lists them. */
export function TagManager({ siteId, close, onChanged = () => undefined, canManage = false }: { siteId: string; close: () => void; onChanged?: () => void; canManage?: boolean }) {
  const { data: tags = [], isLoading } = useSiteTags(siteId);
  const sorted = useMemo(() => [...tags].sort((a, b) => a.name.localeCompare(b.name, 'pt')), [tags]);
  return (
    <Modal title="Gerir etiquetas" close={close}>
      <div className="modal-form tag-manager">
        <p className="panel-description">As etiquetas pertencem a este site e servem equipamentos e sub-redes. Contagem: equipamentos · sub-redes.</p>
        {isLoading ? <p className="panel-description">A carregar etiquetas…</p> : null}
        {sorted.length ? <ul className="tag-manager-list">{sorted.map((tag) => (canManage
          ? <TagManagerRow key={`${tag.id}:${tag.name}:${tag.color}`} tag={tag} siteId={siteId} onChanged={onChanged} />
          : <TagReadOnlyRow key={tag.id} tag={tag} />))}</ul> : null}
        {canManage ? <NewTagForm siteId={siteId} /> : <p className="panel-description">Só administradores e operadores de sistemas podem criar, renomear ou eliminar etiquetas.</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Fechar</button></div>
      </div>
    </Modal>
  );
}

export function ManageTagsButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="secondary-button" aria-label="Gerir etiquetas" title="Gerir etiquetas" onClick={onClick}><Tags size={14} /> <span className="toolbar-action-label">Gerir etiquetas</span></button>;
}
