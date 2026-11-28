'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Tags, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/modal';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { createTag, deleteTag, listTags, tagsQueryKey, updateTag } from './api';
import { TAG_COLORS, TAG_NAME_MAX_LENGTH, TAGS_PER_ITEM_LIMIT, parseTagFilterValue, tagColorClass, type Tag, type TagColor, type TagSummary } from './types';
import { useUiText } from '@/components/ui/use-ui-text';

type UiText = ReturnType<typeof useUiText>;

/** Message key of each colour's name (tags.color.gray, tags.color.blue, …). */
const colorKeys: Record<TagColor, string> = {
  gray: 'tags.color.gray',
  blue: 'tags.color.blue',
  green: 'tags.color.green',
  amber: 'tags.color.amber',
  red: 'tags.color.red',
  purple: 'tags.color.purple',
};

function errorText(error: unknown, ui: UiText) {
  return error instanceof Error ? error.message : ui('tags.saveError');
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
  const ui = useUiText();
  if (!tags?.length) return null;
  const shown = limit ? tags.slice(0, limit) : tags;
  const hidden = tags.length - shown.length;
  return (
    <span className={`tag-chips${className ? ` ${className}` : ''}`} aria-label={ui('tags.label')}>
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
  const ui = useUiText();
  const { data: tags = [] } = useSiteTags(siteId);
  const current = parseTagFilterValue(value)[0] ?? '';
  const known = !current || tags.some((tag) => tag.id === current);
  if (!siteId) return null;
  return (
    <select className={`tag-filter${className ? ` ${className}` : ''}`} aria-label={ui('tags.filter.label')} title={ui('tags.filter.label')} value={current} onChange={(event) => onChange(event.target.value)}>
      <option value="">{ui('tags.filter.all')}</option>
      {!known ? <option value={current}>{ui('tags.filter.removed')}</option> : null}
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
  const ui = useUiText();
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as TagColor)}>
      {TAG_COLORS.map((color) => <option key={color} value={color}>{ui(colorKeys[color])}</option>)}
    </select>
  );
}

function NewTagForm({ siteId, onCreated }: { siteId: string; onCreated?: (tag: Tag) => void }) {
  const ui = useUiText();
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
      <input aria-label={ui('tags.new.nameLabel')} placeholder={ui('tags.new.placeholder')} maxLength={TAG_NAME_MAX_LENGTH} value={name} onChange={(event) => setName(event.target.value)} />
      <ColorSelect value={color} onChange={setColor} label={ui('tags.new.colorLabel')} />
      <button type="submit" className="secondary-button" disabled={!name.trim() || mutation.isPending}><Plus size={13} /> {ui('tags.new.create')}</button>
      {mutation.isError ? <p className="form-error" role="alert">{errorText(mutation.error, ui)}</p> : null}
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
  const ui = useUiText();
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
    <Modal title={ui('tags.editor.title', undefined, { name: itemLabel })} close={close}>
      <div className="modal-form tag-editor">
        {isLoading ? <p className="panel-description">{ui('tags.loading')}</p> : null}
        {!isLoading && !tags.length ? <p className="panel-description">{canCreate ? ui('tags.empty.canCreate') : ui('tags.empty.readOnly')}</p> : null}
        {tags.length ? (
          <fieldset className="tag-editor-options" aria-label={ui('tags.editor.options')}>
            {tags.map((tag) => (
              <label key={tag.id} className="tag-editor-option">
                <input type="checkbox" checked={chosen.has(tag.id)} onChange={() => toggle(tag.id)} />
                <span className={`tag-chip tag-chip--${tagColorClass(tag.color)}`}>{tag.name}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {canCreate ? <NewTagForm siteId={siteId} onCreated={(tag) => setChosen((current) => (current.size < TAGS_PER_ITEM_LIMIT ? new Set(current).add(tag.id) : current))} /> : null}
        {mutation.isError ? <p className="form-error" role="alert">{errorText(mutation.error, ui)}</p> : null}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={close}>{ui('tags.editor.cancel')}</button>
          <button type="button" className="primary-button" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{ui('tags.editor.save')}</button>
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
    const message = uses ? ui('tags.manager.confirmDeleteUsed', undefined, { name: tag.name, uses }) : ui('tags.manager.confirmDelete', undefined, { name: tag.name });
    if (await confirm({ message, destructive: true })) remove.mutate();
  };
  const error = save.error ?? remove.error;
  return (
    <li className="tag-manager-row">
      <input aria-label={ui('tags.manager.nameLabel')} maxLength={TAG_NAME_MAX_LENGTH} value={name} onChange={(event) => setName(event.target.value)} />
      <ColorSelect value={color} onChange={setColor} label={ui('tags.manager.colorLabel')} />
      <small className="tag-manager-uses" title={ui('tags.manager.usesTitle')}>{tag.deviceCount} · {tag.subnetCount}</small>
      <button type="button" className="secondary-button" disabled={!dirty || !name.trim() || save.isPending} onClick={() => save.mutate()}>{ui('tags.manager.save')}</button>
      <button type="button" className="icon-button subtle" aria-label={ui('tags.deleteNamed', undefined, { name: tag.name })} disabled={remove.isPending} onClick={() => void askRemove()}><Trash2 size={14} /></button>
      {error ? <p className="form-error" role="alert">{errorText(error, ui)}</p> : null}
      {confirmDialog}
    </li>
  );
}

function TagReadOnlyRow({ tag }: { tag: Tag }) {
  const ui = useUiText();
  return (
    <li className="tag-manager-row">
      <span className={`tag-chip tag-chip--${tagColorClass(tag.color)}`}>{tag.name}</span>
      <small className="tag-manager-uses" title={ui('tags.manager.usesTitle')}>{tag.deviceCount} · {tag.subnetCount}</small>
    </li>
  );
}

/** Rename, recolour and delete the site's tags; without `canManage` it only lists them. */
export function TagManager({ siteId, close, onChanged = () => undefined, canManage = false }: { siteId: string; close: () => void; onChanged?: () => void; canManage?: boolean }) {
  const ui = useUiText();
  const { data: tags = [], isLoading } = useSiteTags(siteId);
  const sorted = useMemo(() => [...tags].sort((a, b) => a.name.localeCompare(b.name, 'pt')), [tags]);
  return (
    <Modal title={ui('tags.manage')} close={close}>
      <div className="modal-form tag-manager">
        <p className="panel-description">{ui('tags.manager.description')}</p>
        {isLoading ? <p className="panel-description">{ui('tags.loading')}</p> : null}
        {sorted.length ? <ul className="tag-manager-list">{sorted.map((tag) => (canManage
          ? <TagManagerRow key={`${tag.id}:${tag.name}:${tag.color}`} tag={tag} siteId={siteId} onChanged={onChanged} />
          : <TagReadOnlyRow key={tag.id} tag={tag} />))}</ul> : null}
        {canManage ? <NewTagForm siteId={siteId} /> : <p className="panel-description">{ui('tags.manager.readOnlyNote')}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>{ui('tags.manager.close')}</button></div>
      </div>
    </Modal>
  );
}

export function ManageTagsButton({ onClick }: { onClick: () => void }) {
  const ui = useUiText();
  const label = ui('tags.manage');
  return <button type="button" className="secondary-button" aria-label={label} title={label} onClick={onClick}><Tags size={14} /> <span className="toolbar-action-label">{label}</span></button>;
}
