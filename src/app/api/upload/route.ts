import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;
        const path = formData.get('path') as string;
        const authHeader = req.headers.get('Authorization');

        if (!file || !path) {
            return NextResponse.json({ error: 'File and path are required' }, { status: 400 });
        }

        if (!authHeader) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const bucket = 'zenergy-f8276.firebasestorage.app';
        const encodedPath = encodeURIComponent(path);
        const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?name=${encodedPath}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': file.type,
            },
            body: file,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Firebase Storage Upload Error:', errorText);
            return NextResponse.json({ error: 'Upload failed', details: errorText }, { status: response.status });
        }

        const data = await response.json();
        const downloadToken = data.downloadTokens;
        const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${downloadToken}`;

        return NextResponse.json({ downloadUrl });
    } catch (error) {
        console.error('Proxy Upload Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
