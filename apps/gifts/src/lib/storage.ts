import fs from "fs";
import path from "path";

const SHARED_MEDIA_DIR = "/app/media";

export interface FileStats {
	exists: boolean;
	size: number; // in bytes
}

/**
 * Extracts the file path on the shared media volume from its public URL.
 * URL format: http(s)://<domain>/media/<relative_path>
 */
export function getFilePathFromUrl(fileUrl: string): string | null {
	if (!fileUrl) return null;
	
	try {
		const parsedUrl = new URL(fileUrl);
		const pathname = parsedUrl.pathname; // e.g. "/media/file_uploads/abc.jpg"
		
		// Find the index of "/media/" in the pathname
		const mediaPrefixIndex = pathname.indexOf("/media/");
		if (mediaPrefixIndex === -1) {
			return null;
		}
		
		// Extract the relative path (e.g. "file_uploads/abc.jpg")
		const relativePath = pathname.substring(mediaPrefixIndex + 7);
		
		// Secure path resolution preventing directory traversal
		const resolvedPath = path.resolve(SHARED_MEDIA_DIR, relativePath);
		if (!resolvedPath.startsWith(SHARED_MEDIA_DIR)) {
			console.warn(`Blocked potential directory traversal attack: ${fileUrl}`);
			return null;
		}
		
		return resolvedPath;
	} catch (error) {
		// If URL is not valid, try mapping it as a simple relative path fallback
		if (fileUrl.includes("/media/")) {
			const relativePath = fileUrl.split("/media/")[1];
			const resolvedPath = path.resolve(SHARED_MEDIA_DIR, relativePath);
			if (resolvedPath.startsWith(SHARED_MEDIA_DIR)) {
				return resolvedPath;
			}
		}
		return null;
	}
}

/**
 * Checks if a file exists on the shared volume and returns its size.
 */
export function getFileStats(filePath: string): FileStats {
	try {
		if (fs.existsSync(filePath)) {
			const stats = fs.statSync(filePath);
			return {
				exists: true,
				size: stats.size
			};
		}
	} catch (error) {
		console.error(`Error reading stats for file: ${filePath}`, error);
	}
	return { exists: false, size: 0 };
}

/**
 * Permanently deletes a file from the shared volume.
 */
export function deleteFile(filePath: string): boolean {
	try {
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
			console.log(`Deleted file from disk: ${filePath}`);
			return true;
		}
	} catch (error) {
		console.error(`Error deleting file: ${filePath}`, error);
	}
	return false;
}
