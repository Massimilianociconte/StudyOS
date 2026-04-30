export const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export const readImageFile = async (file?: File) => {
  if (!file) return undefined;
  if (!file.type.startsWith("image/")) throw new Error("Seleziona un file immagine.");
  return fileToDataUrl(file);
};
