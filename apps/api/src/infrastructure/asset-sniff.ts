/**
 * Real file type of an uploaded asset, read from its bytes instead of trusting the declared MIME type.
 * Only the image types the API accepts are recognised: PNG, JPEG and WebP by their signatures, and SVG by a
 * small XML well-formedness check whose root element must be <svg>. Anything else returns null.
 */
export type SniffedImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (bytes: Buffer, signature: number[], offset = 0) => bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value);

export function sniffImageMime(bytes: Buffer): SniffedImageMime | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (isSvgDocument(bytes)) return 'image/svg+xml';
  return null;
}

/** True when the text is well-formed XML (tags balanced, attributes quoted, one root) and that root is <svg>. */
export function isSvgDocument(bytes: Buffer): boolean {
  let text = bytes.toString('utf8');
  if (text.includes('�')) return false; // not valid UTF-8, so not an SVG we can serve
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const stack: string[] = [];
  let root: string | null = null;
  let rootClosed = false;
  let index = 0;
  const nameAt = (from: number) => /^[A-Za-z_][\w.:-]*/.exec(text.slice(from, from + 256))?.[0] ?? '';
  while (index < text.length) {
    const open = text.indexOf('<', index);
    const gap = text.slice(index, open === -1 ? text.length : open);
    // Text outside the root element may only be whitespace.
    if ((root === null || rootClosed) && gap.trim()) return false;
    if (open === -1) break;
    if (text.startsWith('<?', open)) { const end = text.indexOf('?>', open + 2); if (end === -1) return false; index = end + 2; continue; }
    if (text.startsWith('<!--', open)) { const end = text.indexOf('-->', open + 4); if (end === -1) return false; index = end + 3; continue; }
    if (text.startsWith('<![CDATA[', open)) { if (!stack.length) return false; const end = text.indexOf(']]>', open + 9); if (end === -1) return false; index = end + 3; continue; }
    if (text.startsWith('<!DOCTYPE', open)) {
      if (root !== null) return false;
      // An internal subset ([...]) may contain '>' characters, so skip it before looking for the closing '>'.
      const bracket = text.indexOf('[', open);
      const close = text.indexOf('>', open);
      if (close === -1) return false;
      if (bracket !== -1 && bracket < close) { const subsetEnd = text.indexOf(']', bracket); if (subsetEnd === -1) return false; const end = text.indexOf('>', subsetEnd); if (end === -1) return false; index = end + 1; } else index = close + 1;
      continue;
    }
    if (text.startsWith('</', open)) {
      const name = nameAt(open + 2);
      const end = text.indexOf('>', open);
      if (!name || end === -1 || text.slice(open + 2 + name.length, end).trim() || stack.pop() !== name) return false;
      if (!stack.length) rootClosed = true;
      index = end + 1;
      continue;
    }
    const name = nameAt(open + 1);
    if (!name || rootClosed) return false;
    // Walk the attributes so a '>' inside a quoted value does not end the tag.
    let cursor = open + 1 + name.length;
    let selfClosing = false;
    for (;;) {
      while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
      if (cursor >= text.length) return false;
      if (text[cursor] === '>') { cursor += 1; break; }
      if (text.startsWith('/>', cursor)) { selfClosing = true; cursor += 2; break; }
      const attribute = nameAt(cursor);
      if (!attribute) return false;
      cursor += attribute.length;
      while (/\s/.test(text[cursor] ?? '')) cursor += 1;
      if (text[cursor] !== '=') return false;
      cursor += 1;
      while (/\s/.test(text[cursor] ?? '')) cursor += 1;
      const quote = text[cursor];
      if (quote !== '"' && quote !== "'") return false;
      const valueEnd = text.indexOf(quote, cursor + 1);
      if (valueEnd === -1) return false;
      cursor = valueEnd + 1;
    }
    if (root === null) root = name;
    if (selfClosing) { if (!stack.length) rootClosed = true; } else stack.push(name);
    index = cursor;
  }
  if (root === null || !rootClosed || stack.length) return false;
  const localName = root.includes(':') ? root.slice(root.indexOf(':') + 1) : root;
  return localName === 'svg';
}
