/**
 * Scales a photo down in the browser and re-encodes it as JPEG before it is uploaded.
 * Phone photos are 3–8 MB; at 1600 px they are a few hundred KB and still sharp on any screen.
 * Re-encoding also drops the EXIF data, including the GPS position of the photo.
 * Formats the browser can decode work as input, e.g. HEIC on Safari.
 */
export async function shrinkPhoto(file: File, maxEdge = 1600, quality = 0.85): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    // from-image: phone photos are often stored sideways with a rotation flag
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Dieses Bildformat kann der Browser nicht lesen. Bitte ein JPEG, PNG oder WebP wählen.');
  }

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Das Foto konnte nicht verkleinert werden.');
    // JPEG has no transparency: put transparent PNG parts on white instead of black
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Das Foto konnte nicht verkleinert werden.');

    const name = file.name.replace(/\.[^.]*$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}
