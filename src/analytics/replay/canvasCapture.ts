/** Initiate an asynchronous snapshot while WebGL pixels exist; encode outside POST_RENDER. */
export async function captureReplayCanvas(source: HTMLCanvasElement, options: {
  width: number; height: number; limit: number;
}): Promise<string | null> {
  if (!source.width || !source.height || typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap | null = null;
  try {
    const scale = Math.min(1, options.width / source.width, options.height / source.height);
    bitmap = await createImageBitmap(source, {
      resizeWidth: Math.max(1, Math.round(source.width * scale)),
      resizeHeight: Math.max(1, Math.round(source.height * scale)), resizeQuality: 'low',
    });
    // Yield before the drawing/encoding work; never put a synchronous JPEG encoder in a render callback.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0); bitmap.close(); bitmap = null;
    for (const quality of [0.35, 0.12]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob || blob.size * 4 / 3 + 24 > options.limit) continue;
      const result = await new Promise<string | null>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
      if (result && result.length <= options.limit) return result;
    }
  } catch { /* Tainted/lost/unreadable graphics never interrupt play or written reports. */ }
  finally { bitmap?.close(); }
  return null;
}
