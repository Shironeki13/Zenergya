import { storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

/**
 * Uploads a file to Firebase Storage directly using the Client SDK.
 * @param file The file to upload.
 * @param path The path in storage where the file should be saved.
 * @returns The download URL of the uploaded file.
 */
export async function uploadFile(file: File, path: string): Promise<string> {
    if (!storage) {
        throw new Error("Firebase Storage is not initialized.");
    }

    const storageRef = ref(storage, path);

    try {
        const snapshot = await uploadBytes(storageRef, file);
        const downloadUrl = await getDownloadURL(snapshot.ref);
        return downloadUrl;
    } catch (error: any) {
        console.error("Upload failed:", error);
        throw new Error(error.message || "Upload failed");
    }
}
