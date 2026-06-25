// Restored verbatim from pre-Phase-4 master (b811ffe). 100% presentational:
// takes a Tiptap `editor` and renders the formatting toolbar. No data-layer
// coupling — safe to carry forward unchanged.

import React from 'react';
import { Editor } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Undo,
  Redo,
  Link,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Highlighter,
  Minus,
  Type,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Preset sizes for the font-size picker. Applied to the current
// selection via the FontSize extension (an inline <span style>), so
// they layer on top of — and are independent of — the block heading
// level. "Default" clears the inline size and reverts to the CSS.
const FONT_SIZES: { label: string; value: string }[] = [
  { label: 'Small', value: '14px' },
  { label: 'Normal', value: '16px' },
  { label: 'Large', value: '20px' },
  { label: 'Huge', value: '28px' },
];

interface EditorToolbarProps {
  editor: Editor | null;
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  tooltip: string;
  children: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  onClick,
  isActive = false,
  disabled = false,
  tooltip,
  children,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant={isActive ? 'toolbar-active' : 'toolbar'}
        size="icon"
        onClick={onClick}
        disabled={disabled}
        className="h-8 w-8"
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom" className="text-xs">
      {tooltip}
    </TooltipContent>
  </Tooltip>
);

const ToolbarDivider: React.FC = () => (
  <div className="w-px h-6 bg-border mx-1" />
);

export const EditorToolbar: React.FC<EditorToolbarProps> = ({ editor }) => {
  // Hooks must run before any early return. The font-size picker stashes
  // the editor selection here because the dropdown steals focus on open.
  const savedSelectionRef = React.useRef<{ from: number; to: number } | null>(
    null,
  );

  if (!editor) return null;

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('Enter URL:', previousUrl);

    if (url === null) return;

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  // The font-size picker lives in a dropdown, which steals focus from the
  // editor when it opens — by the time an item is clicked the editor's
  // selection is no longer the user's range, so the size ended up applying
  // to the whole document. Capture the selection the instant the trigger
  // is pressed (before focus moves), then restore it before applying so
  // the size lands on exactly the originally-selected text.
  const captureSelection = () => {
    const { from, to } = editor.state.selection;
    savedSelectionRef.current = { from, to };
  };

  const applyFontSize = (value: string | null) => {
    const sel = savedSelectionRef.current ?? {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    };
    const chain = editor.chain().focus().setTextSelection(sel);
    if (value) chain.setFontSize(value).run();
    else chain.unsetFontSize().run();
  };

  return (
    <div className="flex items-center gap-0.5 px-3 py-2 border-b border-border/50 bg-card overflow-x-auto">
      {/* Undo/Redo */}
      <div className="flex items-center gap-0.5">
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          tooltip="Undo (Ctrl+Z)"
        >
          <Undo className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          tooltip="Redo (Ctrl+Shift+Z)"
        >
          <Redo className="w-4 h-4" />
        </ToolbarButton>
      </div>

      <ToolbarDivider />

      {/* Headings */}
      <div className="flex items-center gap-0.5">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editor.isActive('heading', { level: 1 })}
          tooltip="Heading 1"
        >
          <Heading1 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive('heading', { level: 2 })}
          tooltip="Heading 2"
        >
          <Heading2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          isActive={editor.isActive('heading', { level: 3 })}
          tooltip="Heading 3"
        >
          <Heading3 className="w-4 h-4" />
        </ToolbarButton>
      </div>

      <ToolbarDivider />

      {/* Font size — sets a custom size on the current selection,
          independent of the H1/H2/H3 block headings. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="toolbar"
            size="icon"
            className="h-8 w-8"
            aria-label="Font size"
            onPointerDown={captureSelection}
          >
            <Type className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {FONT_SIZES.map((s) => (
            <DropdownMenuItem
              key={s.value}
              onClick={() => applyFontSize(s.value)}
            >
              {s.label}
              <span className="ml-auto pl-4 text-xs text-muted-foreground">
                {s.value}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => applyFontSize(null)}>
            Default
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ToolbarDivider />

      {/* Text formatting */}
      <div className="flex items-center gap-0.5">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          tooltip="Bold (Ctrl+B)"
        >
          <Bold className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          tooltip="Italic (Ctrl+I)"
        >
          <Italic className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive('underline')}
          tooltip="Underline (Ctrl+U)"
        >
          <Underline className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive('strike')}
          tooltip="Strikethrough"
        >
          <Strikethrough className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          isActive={editor.isActive('highlight')}
          tooltip="Highlight"
        >
          <Highlighter className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive('code')}
          tooltip="Inline Code"
        >
          <Code className="w-4 h-4" />
        </ToolbarButton>
      </div>

      <ToolbarDivider />

      {/* Alignment */}
      <div className="flex items-center gap-0.5">
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          isActive={editor.isActive({ textAlign: 'left' })}
          tooltip="Align Left"
        >
          <AlignLeft className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          isActive={editor.isActive({ textAlign: 'center' })}
          tooltip="Align Center"
        >
          <AlignCenter className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          isActive={editor.isActive({ textAlign: 'right' })}
          tooltip="Align Right"
        >
          <AlignRight className="w-4 h-4" />
        </ToolbarButton>
      </div>

      <ToolbarDivider />

      {/* Lists */}
      <div className="flex items-center gap-0.5">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          tooltip="Bullet List"
        >
          <List className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          tooltip="Numbered List"
        >
          <ListOrdered className="w-4 h-4" />
        </ToolbarButton>
      </div>

      <ToolbarDivider />

      {/* Block elements */}
      <div className="flex items-center gap-0.5">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive('blockquote')}
          tooltip="Quote"
        >
          <Quote className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          tooltip="Horizontal Rule"
        >
          <Minus className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={setLink}
          isActive={editor.isActive('link')}
          tooltip="Add Link"
        >
          <Link className="w-4 h-4" />
        </ToolbarButton>
      </div>
    </div>
  );
};
