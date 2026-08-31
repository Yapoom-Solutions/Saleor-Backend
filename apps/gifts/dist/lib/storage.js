"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFilePathFromUrl = getFilePathFromUrl;
exports.getFileStats = getFileStats;
exports.deleteFile = deleteFile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const SHARED_MEDIA_DIR = "/app/media";
/**
 * Extracts the file path on the shared media volume from its public URL.
 * URL format: http(s)://<domain>/media/<relative_path>
 */
function getFilePathFromUrl(fileUrl) {
    if (!fileUrl)
        return null;
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
        const resolvedPath = path_1.default.resolve(SHARED_MEDIA_DIR, relativePath);
        if (!resolvedPath.startsWith(SHARED_MEDIA_DIR)) {
            console.warn(`Blocked potential directory traversal attack: ${fileUrl}`);
            return null;
        }
        return resolvedPath;
    }
    catch (error) {
        // If URL is not valid, try mapping it as a simple relative path fallback
        if (fileUrl.includes("/media/")) {
            const relativePath = fileUrl.split("/media/")[1];
            const resolvedPath = path_1.default.resolve(SHARED_MEDIA_DIR, relativePath);
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
function getFileStats(filePath) {
    try {
        if (fs_1.default.existsSync(filePath)) {
            const stats = fs_1.default.statSync(filePath);
            return {
                exists: true,
                size: stats.size
            };
        }
    }
    catch (error) {
        console.error(`Error reading stats for file: ${filePath}`, error);
    }
    return { exists: false, size: 0 };
}
/**
 * Permanently deletes a file from the shared volume.
 */
function deleteFile(filePath) {
    try {
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
            console.log(`Deleted file from disk: ${filePath}`);
            return true;
        }
    }
    catch (error) {
        console.error(`Error deleting file: ${filePath}`, error);
    }
    return false;
}
