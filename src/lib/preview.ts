/** Mirrors the commentary composition used by the publishing worker. */
export function composePreviewText(caption: string, hashtags: string): string {
  const cleanCaption = caption.trim();
  const cleanTags = hashtags.trim();
  return (cleanTags ? `${cleanCaption}\n\n${cleanTags}` : cleanCaption).trim();
}

export function composedLength(caption: string, hashtags: string): number {
  return composePreviewText(caption, hashtags).length;
}
