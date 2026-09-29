export const MAX_EMBEDDED_FILE_BYTES = 600 * 1024;

export const fileToDataUrl = (file: File) => {
  if (file.size > MAX_EMBEDDED_FILE_BYTES) {
    return Promise.reject(new Error("File troppo grande per la sincronizzazione (massimo 600 KiB). Aggiungi un link esterno al materiale."));
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
};

export const readImageFile = async (file?: File) => {
  if (!file) return undefined;
  if (!file.type.startsWith("image/")) throw new Error("Seleziona un file immagine.");
  return fileToDataUrl(file);
};

/**
 * Riduce una foto (es. avatar) a un JPEG quadrato di `size` px: pochi KB invece dei MB di una
 * foto da telefono, così resta sotto i limiti della sincronizzazione cloud.
 */
export const resizeImageFile = async (file: File | undefined, size = 256): Promise<string | undefined> => {
  if (!file) return undefined;
  if (!file.type.startsWith("image/")) throw new Error("Seleziona un file immagine.");
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return fileToDataUrl(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Formato immagine non supportato da questo browser.");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return fileToDataUrl(file);
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
};
