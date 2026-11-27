/** Client-side filter of the Modelos, Assets and Interfaces tabs: the trimmed, lower-cased search must appear in the joined values. */
export const matchesSearch = (search: string, ...values: unknown[]) => {
  const normalizedSearch = search.trim().toLowerCase();
  return !normalizedSearch || values.join(' ').toLowerCase().includes(normalizedSearch);
};
