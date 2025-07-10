import "./quill.snow.css";
import React, { useEffect, useRef } from "react";

import Quill from "quill";
import { sanitizePasteHtml } from "virtualized-chat";

interface MarkdownEditorProps {
    handleMessageSent: (message: string) => void;
    value: string;
    selectedEmoji: string;
    resetSelectedEmoji: () => void;
    setValue: (value: string) => void;
}

export const MarkdownEditor = ({
    handleMessageSent,
    value,
    selectedEmoji,
    resetSelectedEmoji,
    setValue
}: MarkdownEditorProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const cursorPositionRef = useRef<number | null>(null);
  const toolbarOptions = ['bold', 'italic', 'underline', 'strike', { 'list': 'ordered' }, { 'list': 'bullet' }];

  const sendMessage = () => {
    handleMessageSent(quillRef?.current?.root?.innerHTML ?? '');
    quillRef?.current?.setText('');
  }

  const handleDrop = (e: DragEvent) => e.preventDefault();

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault();
  
    const clipboardData = e.clipboardData;
    const quill = quillRef.current;
    const selection = quill?.getSelection(true);
  
    if (!clipboardData) return;
  
    const types = Array.from(clipboardData.types);
  
    if (types.includes('text/html')) {
      const pastedData = clipboardData.getData('text/html');
      const processedData = sanitizePasteHtml(pastedData);
      // @ts-expect-error - TODO: types missmatch OK
      quill?.pasteHTML(selection?.index ?? 0, processedData);
    } else if (types.includes('text/plain')) {
      const pastedData = clipboardData.getData('text/plain');
      quill?.insertText(selection?.index ?? 0, pastedData);
    }
  };

  useEffect(() => {
    if (ref.current) {
      quillRef.current = new Quill(ref.current, {
        modules: {
          toolbar: toolbarOptions,
          keyboard: {
            bindings: {
              enter: {
                  key: 13,
                  handler: sendMessage
              }
          },
        }
      },
      theme: "snow",
      });
      quillRef.current.root.innerHTML = value;
      quillRef.current.root.addEventListener("paste", handlePaste);
      quillRef.current.root.addEventListener("drop", handleDrop);

      quillRef.current.on('selection-change', (range) => {
        if (range) {
          cursorPositionRef.current = range.index;
        }
      });

      quillRef.current.on('text-change', () => {
        const selection = quillRef.current?.getSelection();
        if (selection) {
          cursorPositionRef.current = selection.index;
        }
      });
    }
  }, []);

  useEffect(() => {
    const currentQuill = quillRef.current;

    if (currentQuill) {
      if (currentQuill.root.innerHTML !== value) {
        // @ts-expect-error - TODO: types missmatch OK
        const delta = currentQuill.clipboard.convert(value);
        currentQuill.setContents(delta, "silent");
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any    
      const handleTextChange = (_delta: any, _oldDelta: any, _source: any) => {
        const value = currentQuill.root.innerHTML;
        setValue(value);
      };

      currentQuill.on("text-change", handleTextChange);
    }
  }, [quillRef.current, value, setValue, selectedEmoji, resetSelectedEmoji]);

  useEffect(() => {
    if (selectedEmoji && quillRef.current) {
      const currentQuill = quillRef.current;
      const position = cursorPositionRef.current ?? currentQuill.getLength();

      currentQuill.insertText(position, selectedEmoji);
      currentQuill.setSelection(position + selectedEmoji.length, 0);

      resetSelectedEmoji();
    }
  }, [selectedEmoji, resetSelectedEmoji]);

  return (
    <div ref={ref}></div>
  );
}; 