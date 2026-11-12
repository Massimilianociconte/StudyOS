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

export const COVER_TOO_BIG = "Immagine troppo grande anche dopo averla ridotta: scegline una più leggera.";

/**
 * Copertina di materia o esame: ridotta come la foto del profilo (quadrata, pochi KB) così una foto
 * da telefono va bene. Solo se resta sopra il limite della sincronizzazione lo dice, senza
 * consigliare link (una copertina è sempre un'immagine caricata qui).
 */
export const readCoverImage = async (file?: File, size = 320): Promise<string | undefined> => {
  if (!file) return undefined;
  if (!file.type.startsWith("image/")) throw new Error("Seleziona un file immagine.");
  const canShrink = typeof createImageBitmap === "function" && typeof document !== "undefined";
  if (!canShrink && file.size > MAX_EMBEDDED_FILE_BYTES) throw new Error(COVER_TOO_BIG);
  const dataUrl = await resizeImageFile(file, size);
  // Base64: 4 caratteri ogni 3 byte.
  if (dataUrl && (dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75 > MAX_EMBEDDED_FILE_BYTES) throw new Error(COVER_TOO_BIG);
  return dataUrl;
};
