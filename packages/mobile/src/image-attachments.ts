import {
  launchImageLibrary,
  type Asset,
  type ImageLibraryOptions,
} from 'react-native-image-picker';

import type { DraftImageAttachment } from './types';

const MAX_IMAGE_ATTACHMENTS = 4;

export async function pickImageAttachments(
  existingCount: number,
): Promise<DraftImageAttachment[]> {
  const remaining = MAX_IMAGE_ATTACHMENTS - existingCount;
  if (remaining <= 0) {
    return [];
  }

  const response = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: remaining,
    includeBase64: true,
    quality: 0.9,
  } satisfies ImageLibraryOptions);

  if (response.didCancel) {
    return [];
  }

  if (response.errorCode) {
    throw new Error(response.errorMessage || 'Failed to pick images');
  }

  return normalizeImagePickerAssets(response.assets ?? []);
}

export function normalizeImagePickerAssets(
  assets: Asset[],
): DraftImageAttachment[] {
  return assets.flatMap((asset, index) => {
    if (!asset.uri || !asset.base64 || !asset.type?.startsWith('image/')) {
      return [];
    }

    const bytes = asset.fileSize ?? estimateBase64Bytes(asset.base64);
    return [
      {
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        uri: asset.uri,
        name: asset.fileName || `image-${index + 1}`,
        mimeType: asset.type,
        sizeBytes: bytes,
        base64: asset.base64,
      },
    ];
  });
}

export function toUploadAttachments(
  attachments: DraftImageAttachment[],
) {
  return attachments.map(({ uri: _uri, ...attachment }) => attachment);
}

export function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

function estimateBase64Bytes(base64: string): number {
  const normalized = base64.replace(/\s+/g, '');
  const padding = normalized.endsWith('==')
    ? 2
    : normalized.endsWith('=')
      ? 1
      : 0;

  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}
