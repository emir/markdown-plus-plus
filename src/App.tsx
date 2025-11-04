import { useState, useEffect } from 'react';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { DataTable } from '@/components/DataTable';
import { RawMarkdownModal } from '@/components/RawMarkdownModal';
import { NewPostModal } from '@/components/NewPostModal';
import { SidebarTabs } from '@/components/SidebarTabs';
import { Settings } from '@/components/Settings';
import { Sheet } from '@/components/ui/Sheet';
import { Toast, useToast } from '@/components/ui/Toast';
import {
  WelcomeWarningModal,
  shouldShowWarning,
} from '@/components/WelcomeWarningModal';
import {
  selectDirectory,
  readDirectory,
  readFile,
  writeFile,
  deleteFile,
  isFileSystemAccessSupported,
  detectBrowser,
  type BrowserType,
} from '@/lib/fileSystem';
import {
  parseMarkdown,
  stringifyMarkdown,
  updateFrontmatter,
} from '@/lib/markdown';
import {
  getRecentFolders,
  addRecentFolder,
  clearRecentFolders,
  formatTimestamp,
} from '@/lib/recentFolders';
import { getSettings } from '@/lib/settings';
import {
  saveDirectoryHandle,
  loadDirectoryHandle,
  saveAppState,
  loadAppState,
  clearPersistedData,
} from '@/lib/persistedState';
import type { FileTreeItem, MarkdownFile } from '@/types';
import {
  FolderOpen,
  Save,
  Clock,
  FileCode,
  ArrowLeft,
  Plus,
  RotateCcw,
  Settings as SettingsIcon,
  Menu,
  LogOut,
  Github,
  AlertCircle,
  Copy,
  CopyCheck
} from 'lucide-react';

type ViewMode = 'table' | 'editor' | 'settings';

function App() {
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(
    null
  );
  const [allPosts, setAllPosts] = useState<MarkdownFile[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<MarkdownFile | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [showRawModal, setShowRawModal] = useState(false);
  const [showNewPostModal, setShowNewPostModal] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [browser, setBrowser] = useState<BrowserType>('unknown');
  const [showCopySuccess, setShowCopySuccess] = useState(false);
  const { toast, showToast, hideToast } = useToast();

  // Detect browser on mount
  useEffect(() => {
    const browserName = detectBrowser();
    setBrowser(browserName);
  }, []);

  // Check if warning should be shown on mount
  useEffect(() => {
    setShowWarningModal(shouldShowWarning());
  }, []);

  const loadAllPosts = async (
    handle: FileSystemDirectoryHandle,
    fileTree: FileTreeItem[]
  ) => {
    try {
      const posts: MarkdownFile[] = [];

      const loadFile = async (item: FileTreeItem) => {
        if (!item.isDirectory) {
          try {
            const content = await readFile(handle, item.path);
            const parsed = parseMarkdown(content, item.path, item.name);
            posts.push(parsed);
          } catch (error) {
            // Silently skip files that can't be loaded
          }
        } else if (item.children) {
          for (const child of item.children) {
            await loadFile(child);
          }
        }
      };

      for (const item of fileTree) {
        await loadFile(item);
      }

      setAllPosts(posts);
    } catch (error) {
      // Silently handle error
    }
  };

  const handleSelectDirectory = async () => {
    // Check browser support first
    if (!isFileSystemAccessSupported()) {
      showToast(
        'File System Access API is not supported on this device. Please use a desktop browser (Chrome, Edge, or Safari 15.2+).',
        'error'
      );
      return;
    }

    const handle = await selectDirectory();
    if (handle) {
      setDirHandle(handle);
      addRecentFolder(handle);

      // Save to IndexedDB for persistence
      await saveDirectoryHandle(handle);

      const fileTree = await readDirectory(handle);
      await loadAllPosts(handle, fileTree);
    }
  };

  // Restore directory and state on mount
  useEffect(() => {
    const restoreState = async () => {
      try {
        // Try to load persisted directory handle
        const savedHandle = await loadDirectoryHandle();

        if (savedHandle) {
          setDirHandle(savedHandle);
          addRecentFolder(savedHandle);

          // Load posts
          const fileTree = await readDirectory(savedHandle);
          await loadAllPosts(savedHandle, fileTree);

          // Load app state
          const savedState = await loadAppState();
          if (savedState) {
            if (savedState.viewMode) {
              setViewMode(savedState.viewMode);
            }

            // Restore selected file if in editor mode
            if (
              savedState.selectedFilePath &&
              savedState.viewMode === 'editor'
            ) {
              try {
                const fileContent = await readFile(
                  savedHandle,
                  savedState.selectedFilePath
                );
                const fileName =
                  savedState.selectedFilePath.split('/').pop() ||
                  savedState.selectedFilePath;
                const parsed = parseMarkdown(
                  fileContent,
                  savedState.selectedFilePath,
                  fileName
                );
                setCurrentFile(parsed);
                setSelectedFilePath(savedState.selectedFilePath);
              } catch (error) {
                // File might not exist anymore, silently fail
                console.warn(
                  'Could not restore file:',
                  savedState.selectedFilePath
                );
              }
            }
          }

          showToast('Workspace restored', 'success');
        }
      } catch (error) {
        console.error('Failed to restore state:', error);
      } finally {
        setIsRestoring(false);
      }
    };

    restoreState();
  }, []);

  const handleLogout = async () => {
    // Check for unsaved changes
    if (
      hasChanges &&
      !window.confirm('You have unsaved changes. Discard them and logout?')
    ) {
      return;
    }

    // Clear persisted data from IndexedDB
    await clearPersistedData();

    // Clear state
    setDirHandle(null);
    setAllPosts([]);
    setSelectedFilePath(null);
    setCurrentFile(null);
    setHasChanges(false);
    setViewMode('table');

    showToast('Logged out successfully', 'success');
  };

  const handleClearRecent = () => {
    if (window.confirm('Clear all recent folders?')) {
      clearRecentFolders();
      showToast('Recent folders cleared', 'success');
      window.location.reload();
    }
  };

  const handleDiscardChanges = async () => {
    if (!currentFile || !dirHandle || !selectedFilePath || !hasChanges) return;

    const confirmMsg =
      'Discard all unsaved changes?\n\nThis action cannot be undone.';
    if (!window.confirm(confirmMsg)) {
      return;
    }

    try {
      // Reload the file from disk
      const fileContent = await readFile(dirHandle, selectedFilePath);
      const parsed = parseMarkdown(
        fileContent,
        selectedFilePath,
        currentFile.name
      );

      setCurrentFile(parsed);
      setHasChanges(false);
      showToast('Changes discarded', 'info');
    } catch (error) {
      showToast('Failed to discard changes. Please try again.', 'error');
    }
  };

  const handleEditPost = (post: MarkdownFile) => {
    if (
      hasChanges &&
      !window.confirm('You have unsaved changes. Discard them?')
    ) {
      return;
    }
    setCurrentFile(post);
    setSelectedFilePath(post.path);
    setHasChanges(false);
    setViewMode('editor');

    // Save state
    saveAppState({
      selectedFilePath: post.path,
      viewMode: 'editor',
    });
  };

  const handleDeletePost = async (post: MarkdownFile) => {
    if (!dirHandle) return;

    const confirmMsg = `Are you sure you want to delete "${
      post.frontmatter.title || post.name
    }"?\n\nThis action cannot be undone.`;
    if (!window.confirm(confirmMsg)) {
      return;
    }

    try {
      await deleteFile(dirHandle, post.path);

      // Refresh posts
      const fileTree = await readDirectory(dirHandle);
      await loadAllPosts(dirHandle, fileTree);

      // Clear current file if it was deleted
      if (currentFile?.path === post.path) {
        setCurrentFile(null);
        setSelectedFilePath(null);
        setHasChanges(false);
      }

      showToast('Post deleted successfully', 'success');
    } catch (error) {
      showToast('Failed to delete file. Please try again.', 'error');
    }
  };

  const handleCreatePost = async (filename: string, title: string) => {
    if (!dirHandle) return;

    try {
      // Get default meta from settings
      const settings = getSettings();
      const defaultMeta = settings.defaultMeta || {};

      // Create new post with default frontmatter
      const today = new Date().toISOString().split('T')[0];
      const newPost: MarkdownFile = {
        name: filename,
        path: filename,
        content: '',
        frontmatter: {
          title: title,
          date: today,
          author: '',
          description: '',
          categories: [],
          tags: [],
          // Merge in default meta from settings
          ...defaultMeta,
        },
        rawContent: '',
      };

      // Convert to markdown string
      const content = stringifyMarkdown(newPost);

      // Write to file
      await writeFile(dirHandle, filename, content);

      // Refresh posts
      const fileTree = await readDirectory(dirHandle);
      await loadAllPosts(dirHandle, fileTree);

      // Load the new file
      const fileContent = await readFile(dirHandle, filename);
      const parsed = parseMarkdown(fileContent, filename, filename);

      setCurrentFile(parsed);
      setSelectedFilePath(filename);
      setHasChanges(false);
      setViewMode('editor');
      setShowNewPostModal(false);
    } catch (error) {
      showToast('Failed to create file. Please try again.', 'error');
    }
  };

  const handleSave = async () => {
    if (!dirHandle || !currentFile || !selectedFilePath) return;

    try {
      const content = stringifyMarkdown(currentFile);
      await writeFile(dirHandle, selectedFilePath, content);
      setHasChanges(false);

      // Update the post in allPosts
      const updatedPosts = allPosts.map((post) =>
        post.path === currentFile.path ? currentFile : post
      );
      setAllPosts(updatedPosts);

      showToast('Changes saved successfully!', 'success');
    } catch (error) {
      showToast('Failed to save file. Please try again.', 'error');
    }
  };

  const handleContentChange = (content: string) => {
    if (currentFile) {
      setCurrentFile({ ...currentFile, content });
      setHasChanges(true);
    }
  };

  const handleMetaChange = (frontmatter: MarkdownFile['frontmatter']) => {
    if (currentFile) {
      const updated = updateFrontmatter(currentFile, frontmatter);
      setCurrentFile(updated);
      setHasChanges(true);
    }
  };

  // Save view mode changes
  useEffect(() => {
    if (!isRestoring && dirHandle) {
      saveAppState({
        viewMode,
        selectedFilePath: viewMode === 'editor' ? selectedFilePath : null,
      });
    }
  }, [viewMode, selectedFilePath, dirHandle, isRestoring]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges) handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasChanges, currentFile, selectedFilePath]);

  const copyBraveAPILink = async () => {
    try {
      await navigator.clipboard.writeText(
        'brave://flags/#file-system-access-api'
      );
      setShowCopySuccess(true);
      setTimeout(() => setShowCopySuccess(false), 5000);
    } catch (error) {
      showToast('Failed to copy link. Please try again.', 'error');
    }
  };

  if (!dirHandle) {
    // Show loading while restoring
    if (isRestoring) {
      return (
        <div className="flex h-screen items-center justify-center bg-background">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center w-16 h-16 animate-pulse">
              <img
                src="/logo.png"
                alt="Markdown++"
                className="w-full h-full object-contain"
              />
            </div>
            <p className="text-muted-foreground">Restoring workspace...</p>
          </div>
        </div>
      );
    }

    const recentFolders = getRecentFolders();
    const isSupported = isFileSystemAccessSupported();

    return (
      <div className="flex h-screen items-center justify-center bg-background p-3 sm:p-4">
        <div className="w-full max-w-2xl space-y-6 sm:space-y-8">
          {/* Header */}
          <div className="text-center space-y-2 sm:space-y-3">
            <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 mb-2">
              <img
                src="/logo.png"
                alt="Markdown++"
                className="w-full h-full object-contain"
              />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold">Markdown++</h1>
            <p className="text-muted-foreground text-base sm:text-lg px-4">
              Select a folder to start editing your markdown files
            </p>
          </div>

          {/* Browser Compatibility Warning */}
          {!isSupported && (
            <div className="mx-auto max-w-xl">
              <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4">
                <div className="flex gap-3">
                  <AlertCircle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-yellow-500">
                      Device Not Supported
                    </p>
                    <p className="text-muted-foreground">
                      Local folder access is not enabled on your Brave Browser.
                      Please follow the instructions below to enable it.
                    </p>
                    {browser === 'brave' && (
                      <p className="text-xs text-muted-foreground mt-2 border border-yellow-600 rounded p-1">
                        💡 <strong>Solution:</strong> To enable the File System
                        Access API, open a new tab and paste <br />
                        <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs ml-0.5">
                          <code className="ml-1">
                            brave://flags/#file-system-access-api
                          </code>
                          {
                            showCopySuccess ? (
                              <CopyCheck className="inline-block size-3 ml-2" />
                            ) : (
                              <button onClick={copyBraveAPILink} title="Copy to clipboard">
                                <Copy className="inline-block size-3 ml-2 hover:text-foreground transition-colors" />
                              </button>
                            )
                          }
                        </kbd>
                      </p>
                    )}

                    {browser !== 'brave' && (
                      <p className="text-xs text-muted-foreground mt-2">
                        💡 <strong>Tip:</strong> Works on Android with
                        Chrome/Edge
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Main Button */}
          <div className="flex justify-center">
            <button
              onClick={handleSelectDirectory}
              disabled={!isSupported}
              className="inline-flex items-center gap-3 rounded-lg bg-primary px-6 sm:px-8 py-3 sm:py-4 text-base font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-lg hover:shadow-xl touch-target disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary disabled:hover:shadow-lg"
            >
              <FolderOpen className="h-5 w-5" />
              Select Folder
            </button>
          </div>

          {/* Recent Folders */}
          {recentFolders.length > 0 && (
            <div className="space-y-3 sm:space-y-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Recent Folders
                </div>
                <button
                  onClick={handleClearRecent}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors touch-target px-2 py-1"
                >
                  Clear
                </button>
              </div>

              <div className="grid gap-2">
                {recentFolders.map((folder) => (
                  <button
                    key={folder.name + folder.timestamp}
                    onClick={handleSelectDirectory}
                    disabled={!isSupported}
                    className="flex items-center justify-between p-3 sm:p-4 rounded-lg border border-border bg-card hover:bg-accent active:bg-accent/80 transition-colors text-left group touch-target disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-card"
                  >
                    <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                      <div className="shrink-0">
                        <FolderOpen className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate text-sm sm:text-base">
                          {folder.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatTimestamp(folder.timestamp)}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Footer with GitHub Link */}
          <div className="pt-6 border-t border-border">
            <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
              <a
                href="https://github.com/emir/markdown-plus-plus"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 hover:text-foreground transition-colors touch-target py-2 px-3 rounded-md hover:bg-accent"
              >
                <Github className="h-4 w-4" />
                <span>View on GitHub</span>
              </a>
              <span className="text-muted-foreground/50">•</span>
              <span>v0.5.0-beta</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <WelcomeWarningModal
        isOpen={showWarningModal}
        onAccept={() => setShowWarningModal(false)}
      />

      <Toast
        message={toast.message}
        type={toast.type}
        isOpen={toast.isOpen}
        onClose={hideToast}
      />

      <div className="h-screen flex flex-col bg-background">
        {/* Header */}
        <div className="border-b">
          <div className="flex items-center px-2 sm:px-4 gap-2 sm:gap-4 min-h-14 py-2">
            {/* Back Button (only in editor mode) */}
            {viewMode === 'editor' && (
              <button
                onClick={() => setViewMode('table')}
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-2 sm:px-3 py-2.5 hover:bg-accent hover:text-accent-foreground transition-colors shrink-0 touch-target"
                title="Back to posts"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}

            <div className="flex-1 min-w-0">
              {viewMode === 'editor' && currentFile ? (
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-base sm:text-xl truncate">
                      {currentFile.frontmatter.title || currentFile.name}
                    </h2>
                    {hasChanges && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                        <span className="h-2 w-2 rounded-full bg-yellow-500" />
                        <span className="hidden sm:inline">Unsaved</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate hidden sm:block">
                    {currentFile.path}
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => setViewMode('table')}
                  className="flex items-center gap-2 text-lg sm:text-xl font-semibold hover:text-primary transition-colors cursor-pointer"
                >
                  <img
                    src="/logo.png"
                    alt="Markdown++"
                    className="w-7 h-7 sm:w-8 sm:h-8 object-contain"
                  />
                  Markdown++
                </button>
              )}
            </div>

            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              {viewMode !== 'editor' && (
                <>
                  <button
                    onClick={() => setViewMode('settings')}
                    className="inline-flex items-center justify-center rounded-md border border-input bg-background px-2 sm:px-4 py-2.5 hover:bg-accent hover:text-accent-foreground transition-colors touch-target"
                    title="Settings"
                  >
                    <SettingsIcon className="h-5 w-5" />
                  </button>

                  <button
                    onClick={handleLogout}
                    className="inline-flex items-center justify-center rounded-md border border-input bg-background px-2 sm:px-4 py-2.5 hover:bg-destructive/10 hover:text-destructive transition-colors touch-target"
                    title="Logout"
                  >
                    <LogOut className="h-5 w-5" />
                  </button>
                </>
              )}

              {viewMode === 'editor' && currentFile && (
                <>
                  {/* Mobile Menu Button */}
                  <button
                    onClick={() => setIsMobileSidebarOpen(true)}
                    className="lg:hidden inline-flex items-center justify-center rounded-md border border-input bg-background px-2 py-2.5 hover:bg-accent hover:text-accent-foreground transition-colors touch-target"
                    title="Open Sidebar"
                  >
                    <Menu className="h-5 w-5" />
                  </button>

                  {/* Raw Button - Hidden on small mobile */}
                  <button
                    onClick={() => setShowRawModal(true)}
                    className="hidden sm:inline-flex items-center gap-2 rounded-md border border-input bg-background px-2 lg:px-4 py-2.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors touch-target"
                    title="View Raw Markdown"
                  >
                    <FileCode className="h-5 w-5" />
                    <span className="hidden lg:inline">Raw</span>
                  </button>

                  {/* Discard Button - Hidden on small mobile */}
                  <button
                    onClick={handleDiscardChanges}
                    disabled={!hasChanges}
                    className="hidden sm:inline-flex items-center gap-2 rounded-md border border-input bg-background px-2 lg:px-4 py-2.5 text-sm hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 disabled:pointer-events-none transition-colors touch-target"
                    title="Discard Changes"
                  >
                    <RotateCcw className="h-5 w-5" />
                    <span className="hidden lg:inline">Discard</span>
                  </button>

                  {/* Save Button - Always visible */}
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-3 sm:px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors touch-target"
                  >
                    <Save className="h-5 w-5" />
                    <span className="hidden sm:inline">Save</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        {viewMode === 'settings' ? (
          <div className="flex-1 overflow-auto">
            <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8">
              <Settings onClose={() => setViewMode('table')} />
            </div>
          </div>
        ) : viewMode === 'table' ? (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="p-3 sm:p-4 border-b flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-base sm:text-lg">
                  All Posts
                </h2>
                <span className="text-xs sm:text-sm text-muted-foreground">
                  ({allPosts.length} {allPosts.length === 1 ? 'post' : 'posts'})
                </span>
              </div>
              <button
                onClick={() => setShowNewPostModal(true)}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 sm:px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors touch-target"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New Post</span>
                <span className="sm:hidden">New</span>
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-3 sm:p-4">
              <DataTable
                posts={allPosts}
                onEdit={handleEditPost}
                onDelete={handleDeletePost}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Editor */}
            <div className="flex-1 p-2 sm:p-4 overflow-auto">
              {currentFile ? (
                <MarkdownEditor
                  content={currentFile.content}
                  onChange={handleContentChange}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <div className="text-center space-y-2">
                    <p>No file selected</p>
                    <button
                      onClick={() => setViewMode('table')}
                      className="text-sm text-primary hover:underline"
                    >
                      Go to Table View to select a post
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Sidebar with Tabs - Desktop */}
            <div className="hidden lg:block w-96 border-l">
              <SidebarTabs
                currentFile={currentFile}
                allPosts={allPosts}
                onMetaChange={handleMetaChange}
                onPostClick={handleEditPost}
              />
            </div>

            {/* Mobile Sidebar Sheet */}
            <Sheet
              isOpen={isMobileSidebarOpen}
              onClose={() => setIsMobileSidebarOpen(false)}
              side="right"
              title="Post Details"
            >
              <SidebarTabs
                currentFile={currentFile}
                allPosts={allPosts}
                onMetaChange={handleMetaChange}
                onPostClick={(post) => {
                  handleEditPost(post);
                  setIsMobileSidebarOpen(false);
                }}
              />
            </Sheet>
          </div>
        )}

        {/* Raw Markdown Modal */}
        {currentFile && (
          <RawMarkdownModal
            isOpen={showRawModal}
            onClose={() => setShowRawModal(false)}
            content={currentFile.rawContent || stringifyMarkdown(currentFile)}
            filename={currentFile.path}
          />
        )}

        {/* New Post Modal */}
        <NewPostModal
          isOpen={showNewPostModal}
          onClose={() => setShowNewPostModal(false)}
          onCreate={handleCreatePost}
        />
      </div>
    </>
  );
}

export default App;
