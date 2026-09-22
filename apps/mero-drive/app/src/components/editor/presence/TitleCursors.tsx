// Peers' carets over the title input. An input has no DOM inside it to
// decorate, so the markers are absolutely positioned siblings placed by
// measuring the text the caret sits after.

import React, { useEffect, useState } from 'react';
import type { TitleCaret } from '@/lib/rich/cursors';

interface Box {
  left: number;
  selectionLeft: number;
  width: number;
}

interface Props {
  carets: TitleCaret[];
  text: string;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
}

/** Text width in the input's own font, or null when measurement is unavailable. */
function measurer(input: HTMLInputElement | null): ((s: string) => number) | null {
  if (!input) return null;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return null;
  context.font = window.getComputedStyle(input).font;
  return (value: string) => context.measureText(value).width;
}

export function TitleCursors({ carets, text, inputRef }: Props) {
  const [boxes, setBoxes] = useState<Map<string, Box>>(new Map());

  useEffect(() => {
    const input = inputRef.current;
    const measure = measurer(input);
    if (!input || !measure || carets.length === 0) {
      setBoxes(new Map());
      return;
    }
    // The overlay spans the wrapper, icon included; the field centres its text inside itself.
    const origin = input.offsetLeft + input.clientLeft + Math.max((input.clientWidth - measure(text)) / 2, 0);
    setBoxes(
      new Map(
        carets.map((caret) => [
          caret.author,
          {
            left: origin + measure(text.slice(0, caret.caret)),
            selectionLeft: origin + measure(text.slice(0, caret.from)),
            width: measure(text.slice(caret.from, caret.to)),
          },
        ]),
      ),
    );
  }, [carets, text, inputRef]);

  if (carets.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {carets.map((caret) => {
        const box = boxes.get(caret.author) ?? {
          left: 0,
          selectionLeft: 0,
          width: 0,
        };
        return (
          <React.Fragment key={caret.author}>
            {caret.from !== caret.to && (
              <span
                data-testid="presence-selection"
                data-author={caret.author}
                className="absolute bottom-0 top-0 rounded-sm"
                style={{
                  left: box.selectionLeft,
                  width: Math.max(box.width, 2),
                  backgroundColor: `${caret.colour}33`,
                }}
              />
            )}
            <span
              data-testid="presence-cursor"
              data-author={caret.author}
              title={caret.name}
              className="absolute bottom-0 h-0.5 w-2 rounded-full"
              style={{ left: box.left, backgroundColor: caret.colour }}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}
