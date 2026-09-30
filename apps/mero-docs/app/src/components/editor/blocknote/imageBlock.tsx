// BlockNote's image block with this app's rendering: the picture is only ever
// read from a blob, and a wait or a failure shows in the block itself.

import { createContext, useContext, type ComponentProps } from 'react';
import { createImageBlockConfig } from '@blocknote/core';
import {
  createReactBlockSpec,
  ResizableFileBlockWrapper,
  type ReactCustomBlockRenderProps,
} from '@blocknote/react';
import { ImageIcon, ImageOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBlobImage, type BlobImage } from '@/hooks/useBlobImage';
import { parseBlobRef } from '@/lib/images';

const NOTICE_WIDTH = 'min(100%, 28rem)'; // a placeholder's width until the picture sets its own
const UNAVAILABLE = 'Image unavailable';

/** The docs context an open document's images are read through. */
export const ImageContext = createContext<string | null>(null);

type Props = ReactCustomBlockRenderProps<typeof createImageBlockConfig>;
// BlockNote types its file wrapper for the generic file block; the image block is one.
type WrapperProps = ComponentProps<typeof ResizableFileBlockWrapper>;
type Waiting = Exclude<BlobImage, { status: 'loaded' }>;

const NOTICES: Record<Waiting['status'], { title: string; body?: string }> = {
  loading: { title: 'Loading image…' },
  unavailable: {
    title: UNAVAILABLE,
    body: 'The member who added it may be offline.',
  },
  denied: { title: UNAVAILABLE, body: "Images can't be loaded in this session." },
  broken: { title: UNAVAILABLE, body: "This image can't be shown." },
};

function ImageNotice({
  image,
  width,
  onRetry,
}: {
  image: Waiting;
  width?: number;
  onRetry?: () => void;
}) {
  const { title, body } = NOTICES[image.status];
  const Icon = image.status === 'loading' ? Loader2 : ImageOff;
  return (
    <div
      role="status"
      data-image-status={image.status}
      contentEditable={false}
      className="flex min-h-40 max-w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-4 text-center"
      style={{ width: width ?? NOTICE_WIDTH }}
    >
      <Icon
        aria-hidden
        className={`mb-1 h-5 w-5 text-muted-foreground ${image.status === 'loading' ? 'animate-spin' : ''}`}
      />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {body && <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2 h-8" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

function ImagePreview({ block }: Props) {
  const contextId = useContext(ImageContext);
  const { image, retry } = useBlobImage(block.props.url, contextId);
  if (image.status !== 'loaded') {
    return (
      <ImageNotice
        image={image}
        width={block.props.previewWidth}
        onRetry={image.status === 'unavailable' ? retry : undefined}
      />
    );
  }
  return (
    <img
      className="bn-visual-media"
      src={image.url}
      alt={block.props.name}
      width={block.props.previewWidth}
      contentEditable={false}
      draggable={false}
    />
  );
}

function ImageBlock(props: Props) {
  if (!parseBlobRef(props.block.props.url)) {
    return <ImageNotice image={{ status: 'broken' }} />;
  }
  return (
    <ResizableFileBlockWrapper {...(props as unknown as WrapperProps)} buttonIcon={<ImageIcon />}>
      <ImagePreview {...props} />
    </ResizableFileBlockWrapper>
  );
}

// No `parse` rule: pasted HTML's <img> never becomes an image block, since its src is an address.
export const imageBlock = createReactBlockSpec(createImageBlockConfig, {
  render: ImageBlock,
  // A blob reference means nothing outside this app, so a copy carries the words.
  toExternalHTML: ({ block }) => <p>{block.props.caption || block.props.name}</p>,
})();
