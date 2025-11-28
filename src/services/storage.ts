import { auth } from '@/lib/firebase';

/**
 * Uploads a file to Firebase Storage via a server-side proxy to bypass CORS.
 * @param file The file to upload.
 * @param path The path in storage where the file should be saved.
 * @returns The download URL of the uploaded file.
 */
export async function uploadFile(file: File, path: string): Promise<string> {
    const user = auth.currentUser;
    if (!user) {
        throw new Error("User must be authenticated to upload files.");
    }

    const token = await user.getIdToken();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', path);

    const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
    }

    const data = await response.json();
    return data.downloadUrl;
}
