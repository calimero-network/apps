import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PenTool, Plus, Trash2 } from 'lucide-react';
import { MobileLayout } from '../../components/MobileLayout';
import SignaturePadComponent from '../../components/SignaturePad';
import { ClientApiDataSource } from '../../api/dataSource/ClientApiDataSource';
import { blobClient, useCalimero } from '@calimero-network/calimero-client';
import bs58 from 'bs58';

/**
 * Normalize blob ID to base58 format for the contract.
 * The blob API may return hex-encoded IDs (64 chars) or base58 IDs.
 * The contract expects base58-encoded 32-byte blob IDs.
 */
function normalizeBlobIdToBase58(blobId: string): string {
  // Remove any '0x' prefix if present
  const cleanId = blobId.startsWith('0x') ? blobId.slice(2) : blobId;

  // Check if it's a 64-character hex string (32 bytes in hex)
  const isHex = /^[0-9a-fA-F]{64}$/.test(cleanId);

  if (isHex) {
    // Convert hex to bytes, then encode to base58
    const bytes = new Uint8Array(
      cleanId.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    );
    return bs58.encode(bytes);
  }

  // Already in base58 or another format - return as-is
  return cleanId;
}
import {
  Button,
  Card,
  Heading,
  Text,
  Box,
  Flex,
  Modal,
  Loader,
  spacing,
  colors,
  radius,
} from '@calimero-network/mero-ui';

interface SavedSignature {
  id: string;
  name: string;
  dataURL: string;
  createdAt: string;
}

export default function SignaturesPage() {
  const { app } = useCalimero();
  const api = useMemo(() => new ClientApiDataSource(app), [app]);

  const [signatures, setSignatures] = useState<SavedSignature[]>([]);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [deleteSignatureId, setDeleteSignatureId] = useState<string | null>(
    null,
  );

  const fetchSignatures = useCallback(async () => {
    try {
      const response = await api.listSignatures();

      let signaturesArray: any[] = [];

      if (response.data) {
        if (Array.isArray(response.data)) {
          signaturesArray = response.data;
        } else if (
          response.data.output &&
          Array.isArray(response.data.output)
        ) {
          signaturesArray = response.data.output;
        } else if (
          response.data.result &&
          Array.isArray(response.data.result)
        ) {
          signaturesArray = response.data.result;
        }
      }

      if (!signaturesArray || signaturesArray.length === 0) {
        setSignatures([]);
        return;
      }

      const signaturesWithImages = await Promise.all(
        signaturesArray.map(async (sig: any) => {
          let dataURL = '';
          try {
            // Convert blob_id from byte array to base58 string if needed
            const blobId =
              typeof sig.blob_id === 'string'
                ? sig.blob_id
                : bs58.encode(new Uint8Array(sig.blob_id));
            const contextId = localStorage.getItem('defaultContextId') || '';
            const blob = await blobClient.downloadBlob(blobId, contextId);
            if (blob) {
              dataURL = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
            }
          } catch (e) {
            console.error(
              `Failed to fetch signature PNG for blobId ${sig.blob_id}:`,
              e,
            );
          }
          return {
            id: sig.id.toString(),
            name: sig.name,
            dataURL,
            createdAt: new Date(
              Number(sig.created_at) / 1_000_000,
            ).toLocaleString(),
          };
        }),
      );

      setSignatures(signaturesWithImages);
    } catch (error) {
      console.error('Failed to list signatures:', error);
      setSignatures([]);
    }
  }, [api]);

  useEffect(() => {
    fetchSignatures();
  }, [fetchSignatures]);

  const dataURLToBlob = (dataURL: string): Blob => {
    const arr = dataURL.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  const uploadSignatureBlob = async (blob: Blob) => {
    const file = new File([blob], 'signature.png', { type: blob.type });
    const onProgress = (progress: number) => {};

    const blobResponse = await blobClient.uploadBlob(file, onProgress, '');

    if (blobResponse.error || !blobResponse.data?.blobId) {
      const errorMessage =
        blobResponse.error?.message ?? 'Failed to get blob ID from upload';
      console.error(`Upload failed:`, errorMessage);
      throw new Error(errorMessage);
    }

    // Normalize blob ID to base58 for the contract
    const base58BlobId = normalizeBlobIdToBase58(blobResponse.data.blobId);

    return {
      blobId: base58BlobId,
      size: file.size,
    };
  };

  const handleCreateSignature = () => {
    setShowSignaturePad(true);
  };

  const handleSaveSignature = async (signatureData: string) => {
    try {
      const blob = dataURLToBlob(signatureData);
      const { blobId, size } = await uploadSignatureBlob(blob);

      const newSignatureName = `Signature ${signatures.length + 1}`;
      await api.createSignature(newSignatureName, blobId, size);

      await fetchSignatures();
    } catch (error) {
      console.error('Failed to save signature:', error);
    } finally {
      setShowSignaturePad(false);
    }
  };

  const handleCancelSignature = () => {
    setShowSignaturePad(false);
  };

  const handleDeleteSignature = (id: string) => {
    setDeleteSignatureId(id);
  };

  const confirmDeleteSignature = async () => {
    if (deleteSignatureId) {
      try {
        await api.deleteSignature(Number(deleteSignatureId));
        await fetchSignatures();
      } catch (error) {
        console.error('Failed to delete signature:', error);
      } finally {
        setDeleteSignatureId(null);
      }
    }
  };

  const cancelDeleteSignature = () => {
    setDeleteSignatureId(null);
  };

  return (
    <MobileLayout>
      {/* Page Header */}
      <Box style={{ marginBottom: spacing[6].value }}>
        <Heading size="xl" style={{ marginBottom: spacing[2].value }}>
          Signature Library
        </Heading>
        <Text size="lg" className="text-muted-foreground">
          Manage your digital signatures for document signing
        </Text>
      </Box>

      {/* Action Bar */}
      <Flex
        style={{
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: spacing[6].value,
          gap: spacing[4].value,
        }}
      >
        <Button
          onClick={handleCreateSignature}
          variant="primary"
          style={{
            padding: `${spacing[3].value} ${spacing[6].value}`,
            minHeight: '44px',
          }}
        >
          <Plus size={20} className="mr-2" />
          Create New Signature
        </Button>
      </Flex>

      {/* Signatures Grid or Empty State */}
      {signatures.length > 0 ? (
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          style={{ gap: spacing[6].value }}
        >
          {signatures.map((signature) => (
            <Card
              key={signature.id}
              className="transition-all duration-300 cursor-pointer hover:-translate-y-1 hover:shadow-lg"
              style={{
                padding: spacing[6].value,
                borderRadius: radius.md.value,
              }}
            >
              <Box
                className="flex items-center justify-center overflow-hidden"
                style={{
                  height: '80px',
                  backgroundColor: colors.background.secondary.value,
                  border: `1px solid ${colors.neutral[200]?.value || '#e5e7eb'}`,
                  borderRadius: radius.sm.value,
                  marginBottom: spacing[4].value,
                }}
              >
                {signature.dataURL ? (
                  <img
                    src={signature.dataURL}
                    alt={signature.name}
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <Flex style={{ alignItems: 'center', gap: spacing[2].value }}>
                    <Loader size="small" />
                    <Text size="sm" className="text-muted-foreground">
                      Loading...
                    </Text>
                  </Flex>
                )}
              </Box>

              <Heading size="sm" style={{ marginBottom: spacing[2].value }}>
                {signature.name}
              </Heading>

              <Text
                size="sm"
                className="text-muted-foreground"
                style={{ marginBottom: spacing[4].value }}
              >
                Created: {signature.createdAt}
              </Text>

              <Flex style={{ gap: spacing[2].value }}>
                <Button
                  onClick={() => handleDeleteSignature(signature.id)}
                  variant="error"
                  className="flex-1"
                  style={{
                    minHeight: '36px',
                    padding: `${spacing[2].value} ${spacing[3].value}`,
                  }}
                >
                  <Trash2 size={16} className="mr-1" />
                  Delete
                </Button>
              </Flex>
            </Card>
          ))}
        </div>
      ) : (
        <Box
          className="text-center"
          style={{ padding: `${spacing[6].value} 0` }}
        >
          <PenTool
            className="mx-auto text-muted-foreground"
            size={64}
            style={{ marginBottom: spacing[6].value }}
          />
          <Heading size="md" style={{ marginBottom: spacing[2].value }}>
            No Signatures Yet
          </Heading>
          <Text
            size="md"
            className="text-muted-foreground"
            style={{ marginBottom: spacing[6].value }}
          >
            Create your first digital signature to start signing documents
          </Text>
        </Box>
      )}

      {/* Signature Pad Modal */}
      <SignaturePadComponent
        isOpen={showSignaturePad}
        onSave={handleSaveSignature}
        onCancel={handleCancelSignature}
      />

      {/* Delete Confirmation Modal */}
      {deleteSignatureId && (
        <Modal
          open={true}
          onClose={cancelDeleteSignature}
          title="Delete Signature"
        >
          <Box
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: spacing[4].value,
            }}
          >
            <Text size="md" className="text-muted-foreground">
              Are you sure you want to delete this signature? This action cannot
              be undone.
            </Text>

            <Flex style={{ justifyContent: 'flex-end', gap: spacing[2].value }}>
              <Button
                onClick={cancelDeleteSignature}
                variant="secondary"
                style={{ padding: `${spacing[2].value} ${spacing[4].value}` }}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDeleteSignature}
                variant="error"
                style={{ padding: `${spacing[2].value} ${spacing[4].value}` }}
              >
                Delete
              </Button>
            </Flex>
          </Box>
        </Modal>
      )}
    </MobileLayout>
  );
}
