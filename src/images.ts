export const LIBRARY_URL = "/avatar-library.png";

export async function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new Error(
          "This image could not be opened. Please choose a JPEG, PNG, or WebP image.",
        ),
      );
    image.src = source;
  });
}

export async function readPhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a JPEG, PNG, or WebP photo.");
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Choose a photo smaller than 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (image.width < 128 || image.height < 128)
      throw new Error("Use a photo at least 128 × 128 pixels.");
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function avatarCanvas(index: number): Promise<HTMLCanvasElement> {
  const image = await loadImage(LIBRARY_URL);
  const panelWidth = image.width / 4;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(panelWidth);
  // Exclude the contact-sheet label while preserving the full body.
  canvas.height = Math.round(image.height * 0.92);
  canvas
    .getContext("2d")!
    .drawImage(
      image,
      index * panelWidth,
      0,
      panelWidth,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  return canvas;
}

export async function downloadAvatar(
  index: number,
  personalized: string | null,
  name: string,
) {
  let canvas: HTMLCanvasElement;
  if (personalized) {
    const image = await loadImage(personalized);
    canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
  } else canvas = await avatarCanvas(index);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error("Download failed. Please try again.")),
      "image/png",
    ),
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `forme-${name}-avatar.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
