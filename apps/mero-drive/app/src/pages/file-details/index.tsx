import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCalimero } from '@calimero-network/calimero-client';
import { AbiClient, FileEntryResponse } from '@/api/AbiClient';
import { FileBlobManager } from '@/api/FileBlobManager';
import { useWorkspace } from '@/context/WorkspaceContext';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Download,
  File as FileIcon,
  Loader2,
  AlertCircle,
  Clock,
  User,
  HardDrive,
  FileType,
} from 'lucide-react';

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(timestamp: number): string {
  let ms = timestamp;
  if (timestamp > 1e18) ms = Math.floor(timestamp / 1e6);
  else if (timestamp > 1e15) ms = Math.floor(timestamp / 1e3);
  else if (timestamp < 1e12) ms = timestamp * 1000;
  const date = new Date(ms);
  if (isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString();
}

function truncateId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

const FileDetailsPage: React.FC = () => {
  const { fileId } = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const { app } = useCalimero();
  const { activeContextId } = useWorkspace();

  const [file, setFile] = useState<FileEntryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    const loadFile = async () => {
      if (!app || !activeContextId || !fileId) return;
      setIsLoading(true);
      setError(null);
      try {
        const client = new AbiClient(app, activeContextId);
        const fileData = await client.getFile({ file_id: fileId });
        if (!fileData) {
          setError('File not found');
        } else {
          setFile(fileData);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file');
      } finally {
        setIsLoading(false);
      }
    };
    loadFile();
  }, [app, activeContextId, fileId]);

  const handleDownload = async () => {
    if (!file || !activeContextId) return;
    setIsDownloading(true);
    try {
      const manager = new FileBlobManager();
      const blob = await manager.downloadFile(file.blob_id, activeContextId);
      manager.triggerBrowserDownload(blob, file.name);
    } catch (err) {
      console.error('Download failed:', err);
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !file) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background gap-4">
        <AlertCircle className="w-12 h-12 text-destructive" />
        <p className="text-lg text-muted-foreground">{error || 'File not found'}</p>
        <Button variant="outline" onClick={() => navigate('/home')} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back to Files
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate('/home')} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <Button onClick={handleDownload} disabled={isDownloading} className="gap-2">
            {isDownloading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Download
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="bg-card border border-border rounded-xl p-8">
          <div className="flex items-start gap-4 mb-8">
            <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <FileIcon className="w-8 h-8 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold truncate">{file.name}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {file.mime_type}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
              <HardDrive className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Size</p>
                <p className="font-medium">{formatFileSize(file.size)}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
              <FileType className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Type</p>
                <p className="font-medium">{file.mime_type}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
              <Clock className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Uploaded</p>
                <p className="font-medium">{formatDate(file.created_at)}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
              <User className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Uploaded by</p>
                <p className="font-medium font-mono text-sm">{truncateId(file.uploaded_by)}</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default FileDetailsPage;
