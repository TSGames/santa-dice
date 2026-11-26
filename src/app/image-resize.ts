/** Upper limit for uploaded prize images, must match MAX_UPLOAD_BYTES in api.php. */
export const MAX_IMAGE_BYTES = 500 * 1024;
const MAX_SIDE = 1600;

/**
 * Shrinks an image in the browser until it fits into maxBytes.
 * Files that already fit are returned unchanged. Larger ones are scaled down
 * and re-encoded as JPEG (transparent areas become white, GIF animation is lost).
 */
export async function shrinkImage(file: File, maxBytes = MAX_IMAGE_BYTES): Promise<File> {
  if (file.size <= maxBytes) {
    return file;
  }
  const image = await loadImage(file);
  let scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  for (let attempt = 0; attempt < 8; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.75, 0.65]) {
      const blob = await toBlob(canvas, quality);
      if (blob.size <= maxBytes) {
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {type: 'image/jpeg'});
      }
    }
    scale *= 0.75;
  }
  throw new Error('Das Bild lässt sich nicht auf 500 KB verkleinern.');
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bild konnte nicht gelesen werden.'));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Bild konnte nicht verkleinert werden.')), 'image/jpeg', quality));
}
