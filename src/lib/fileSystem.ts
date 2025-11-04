import type { FileTreeItem } from '@/types';

export type BrowserType = 'brave' | 'chrome' | 'edge' | 'safari' | 'firefox' | 'opera' | 'unknown';

/**
 * Detect the browser name
 */
export function detectBrowser(): BrowserType {
  const userAgent = navigator.userAgent.toLowerCase();
  const nav = navigator as { brave?: unknown };
  
  if (userAgent.includes('brave') || nav.brave) {
    return 'brave';
  } else if (userAgent.includes('edg')) {
    return 'edge';
  } else if (userAgent.includes('chrome')) {
    return 'chrome';
  } else if (userAgent.includes('safari') && !userAgent.includes('chrome')) {
    return 'safari';
  } else if (userAgent.includes('firefox')) {
    return 'firefox';
  } else if (userAgent.includes('opera') || userAgent.includes('opr')) {
    return 'opera';
  }
  
  return 'unknown';
}

/**
 * Check if File System Access API is supported
 */
export function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

export async function selectDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    // Check if the API is supported
    if (!isFileSystemAccessSupported()) {
      throw new Error('File System Access API is not supported in this browser');
    }
    
    const dirHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
    });
    return dirHandle;
  } catch (err) {
    return null;
  }
}

export async function readDirectory(
  dirHandle: FileSystemDirectoryHandle,
  path = ''
): Promise<FileTreeItem[]> {
  const items: FileTreeItem[] = [];

  for await (const entry of dirHandle.values()) {
    const itemPath = path ? `${path}/${entry.name}` : entry.name;

    if (entry.kind === 'directory') {
      const subDirHandle = await dirHandle.getDirectoryHandle(entry.name);
      const children = await readDirectory(subDirHandle, itemPath);
      items.push({
        name: entry.name,
        path: itemPath,
        isDirectory: true,
        children,
      });
    } else if (entry.kind === 'file' && entry.name.endsWith('.md')) {
      items.push({
        name: entry.name,
        path: itemPath,
        isDirectory: false,
      });
    }
  }

  return items.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
}

export async function readFile(
  dirHandle: FileSystemDirectoryHandle,
  filePath: string
): Promise<string> {
  const parts = filePath.split('/');
  let currentHandle: FileSystemDirectoryHandle | FileSystemFileHandle = dirHandle;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === parts.length - 1) {
      // Last part - this is the file
      const fileHandle = await (currentHandle as FileSystemDirectoryHandle).getFileHandle(part);
      const file = await fileHandle.getFile();
      return await file.text();
    } else {
      // Directory
      currentHandle = await (currentHandle as FileSystemDirectoryHandle).getDirectoryHandle(part);
    }
  }

  throw new Error('Invalid file path');
}

export async function writeFile(
  dirHandle: FileSystemDirectoryHandle,
  filePath: string,
  content: string
): Promise<void> {
  const parts = filePath.split('/');
  let currentHandle: FileSystemDirectoryHandle = dirHandle;

  for (let i = 0; i < parts.length - 1; i++) {
    currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
  }

  const fileName = parts[parts.length - 1];
  const fileHandle = await currentHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function deleteFile(
  dirHandle: FileSystemDirectoryHandle,
  filePath: string
): Promise<void> {
  const parts = filePath.split('/');
  let currentHandle: FileSystemDirectoryHandle = dirHandle;

  for (let i = 0; i < parts.length - 1; i++) {
    currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
  }

  const fileName = parts[parts.length - 1];
  await currentHandle.removeEntry(fileName);
}

