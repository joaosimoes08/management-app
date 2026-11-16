/** Keeps the Settings user list selection mutually exclusive. */
export function nextSingleUserSelection(selectedId: string, userId: string, checked: boolean): string {
  if (checked) return userId;
  return selectedId === userId ? '' : selectedId;
}
