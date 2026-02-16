import { storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

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

/**
 * Deletes a file from Firebase Storage using its download URL.
 * @param url The download URL of the file to delete.
 */
export async function deleteFileFromUrl(url: string): Promise<void> {
    if (!storage) {
        throw new Error("Firebase Storage is not initialized.");
    }

    try {
        const fileRef = ref(storage, url);
        await deleteObject(fileRef);
    } catch (error: any) {
        console.error("Delete failed:", error);
        // We log but don't throw to avoid blocking the main deletion flow
        // throw new Error(error.message || "Delete failed");
    }
}
