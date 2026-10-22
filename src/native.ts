import { Capacitor } from "@capacitor/core";
import {
  Camera,
  CameraResultType,
  CameraSource,
  CameraDirection,
} from "@capacitor/camera";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export const isNative = Capacitor.isNativePlatform();
const exportDirectory = "forme-exports";

export async function capturePhoto(): Promise<File | null> {
  try {
    const photo = await Camera.getPhoto({
      quality: 90,
      width: 1600,
      height: 1600,
      correctOrientation: true,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Prompt,
      direction: CameraDirection.Rear,
      saveToGallery: false,
      promptLabelHeader: "Customer photo",
      promptLabelPhoto: "Choose photo",
      promptLabelPicture: "Take photo",
      promptLabelCancel: "Cancel",
    });
    if (!photo.dataUrl)
      throw new Error(
        "The photo could not be opened. Please try another photo.",
      );
    const blob = await (await fetch(photo.dataUrl)).blob();
    return new File([blob], "customer-photo.jpg", {
      type: blob.type || "image/jpeg",
    });
  } catch (error) {
    if (
      /cancelled|canceled|user cancelled|no image picked/i.test(
        (error as Error).message,
      )
    )
      return null;
    throw error;
  }
}

export async function clearNativeExports() {
  if (!isNative) return;
  try {
    await Filesystem.rmdir({
      path: exportDirectory,
      directory: Directory.Cache,
      recursive: true,
    });
  } catch (error) {
    // A new install/session may have no export directory; other failures must remain visible.
    if (
      !/not exist|not found|ENOENT|does not exist/i.test(
        (error as Error).message,
      )
    )
      throw error;
  }
}

export async function shareAvatar(dataUrl: string, name: string) {
  await clearNativeExports();
  const file = await Filesystem.writeFile({
    path: `${exportDirectory}/forme-${name}-avatar.png`,
    data: dataUrl.split(",")[1],
    directory: Directory.Cache,
    recursive: true,
  });
  // Keep the export until next export/session/start: Android recipients may read it
  // after the chooser closes. Never delete immediately after Share.share resolves.
  try {
    await Share.share({
      title: "Forme avatar",
      files: [file.uri],
      dialogTitle: "Save or share avatar",
    });
    return true;
  } catch (error) {
    if (/cancelled|canceled/i.test((error as Error).message)) return false;
    throw error;
  }
}
