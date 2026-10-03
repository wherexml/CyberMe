/** Imported attachment descriptors are source metadata, never local artifact IDs. */
export function normalizeInboxAttachments<T extends Record<string, any>>(item: T): T {
  if (!Array.isArray(item.attachments)) return item;
  const sourceAttachments = Array.isArray(item.sourceAttachments) ? [...item.sourceAttachments] : [];
  const attachments: string[] = [];
  for (const attachment of item.attachments) {
    if (typeof attachment === 'string') attachments.push(attachment);
    else if (attachment && typeof attachment === 'object' && !Array.isArray(attachment)) {
      if (!sourceAttachments.some(source => JSON.stringify(source) === JSON.stringify(attachment))) sourceAttachments.push(attachment);
    }
  }
  return {...item, attachments: [...new Set(attachments)], ...(sourceAttachments.length ? {sourceAttachments} : {})};
}
