import Quill from 'quill';
import React, { useEffect, useRef } from 'react';

import { sanitizePasteHtml } from '../utils';

interface InputFieldProps {
  value: string;
  setValue: (value: string) => void;
  handleMessageSend: (value: string) => void;
  isEditMode?: boolean;
  discardChanges?: () => void;
}

const InputField = (props: InputFieldProps): React.JSX.Element => {
  const isMounted = useRef(false);
  const ref = useRef(null);
  const quillRef = useRef<null | Quill>(null);
  const toolbarOptions = [
    'bold',
    'italic',
    'underline',
    'strike',
    { list: 'ordered' },
    { list: 'bullet' },
  ];

  const sendMessage = () => {
    const currentQuill = quillRef.current;
    if (currentQuill) {
      const content = currentQuill.root.innerHTML;
      const cleanContent = content
        .replace(/<br\s*\/?>\s*$/i, '')
        .replace(/<p><br><\/p>\s*$/i, '')
        .replace(/<p>\s*<\/p>\s*$/i, '');

      if (cleanContent.trim() !== '') {
        props.handleMessageSend(cleanContent);
        currentQuill.setText('');
      }
    }
  };

  const handleDrop = (e: DragEvent) => e.preventDefault();
  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault();

    const clipboardData = e.clipboardData;
    const currentQuill = quillRef.current;

    if (!currentQuill) {
      return;
    }
    const selection = currentQuill?.getSelection(true);

    if (clipboardData?.types.includes('text/html')) {
      const pastedData = clipboardData.getData('text/html');
      const processedData = sanitizePasteHtml(pastedData).replace(
        '&nbsp;',
        ' ',
      );

      try {
        currentQuill.clipboard.dangerouslyPasteHTML(
          selection.index,
          processedData,
        );
      } catch (error) {
        const plainText = clipboardData.getData('text/plain');
        currentQuill.insertText(selection.index, plainText);
      }
    } else if (clipboardData?.types.includes('text/plain')) {
      const pastedData = clipboardData.getData('text/plain');
      currentQuill.insertText(selection.index, pastedData);
    }
  };

  useEffect(() => {
    if (!isMounted.current) {
      if (ref.current) {
        quillRef.current = new Quill(ref.current, {
          modules: {
            toolbar: toolbarOptions,
            clipboard: {
              matchVisual: false,
            },
            keyboard: {
              bindings: {
                enter: {
                  key: 13,
                  handler: function () {
                    return false;
                  },
                },
                ...(props.isEditMode
                  ? {
                      escape: {
                        key: 27,
                        handler: props.discardChanges,
                      },
                    }
                  : {}),
              },
            },
          },
          theme: 'snow',
        });

        quillRef.current.root.innerHTML = props.value;
        quillRef.current.root.addEventListener('paste', handlePaste);
        quillRef.current.root.addEventListener('drop', handleDrop);

        const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            setTimeout(() => {
              sendMessage();
            }, 0);
            return false;
          }
          return true;
        };

        quillRef.current.root.addEventListener('keydown', handleKeyDown);
      }
      isMounted.current = true;
    }
  }, []);

  useEffect(() => {
    const currentQuill = quillRef.current;
    if (currentQuill) {
      if (currentQuill.root.innerHTML !== props.value) {
        currentQuill.root.innerHTML = props.value;
      }

      const handleTextChange = () => {
        const value = currentQuill.root.innerHTML;
        props.setValue(value);
      };

      currentQuill.on('text-change', handleTextChange);
    }
  }, [quillRef.current, props.value]);

  return <div ref={ref} />;
};

export default InputField;
