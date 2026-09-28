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
