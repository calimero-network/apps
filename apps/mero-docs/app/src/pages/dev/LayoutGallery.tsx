// Dev-only page: renders every gallery/*.tsx module with mock data, so the
// three search-layout tracks can build and eyeball their screens without the
// node. Never routed in production (see App.tsx).
import * as React from 'react';

import { ThemeToggle } from '@/components/theme/ThemeToggle';

const MOBILE_FRAME_WIDTH = 375; // iPhone-width preview frame

interface GalleryModule {
  title: string;
  order: number;
  Gallery: () => React.JSX.Element;
}

const modules = import.meta.glob('./gallery/*.tsx', { eager: true }) as Record<string, GalleryModule>;
const sections = Object.values(modules).sort((a, b) => a.order - b.order);

function sectionId(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export default function LayoutGallery() {
  const [mobile, setMobile] = React.useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-card px-4 py-2">
        <span className="text-sm font-semibold">Layout gallery</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setMobile((m) => !m)}
          aria-pressed={mobile}
          className="rounded-md border px-2 py-1 text-xs"
        >
          Mobile 375
        </button>
        <ThemeToggle />
      </div>
      <div className="mx-auto max-w-5xl px-4 py-8">
        {sections.map(({ title, Gallery }) => {
          const id = sectionId(title);
          const headingId = `${id}-heading`;
          return (
            <section key={title} id={id} aria-labelledby={headingId} className="mb-12 scroll-mt-16">
              <h2 id={headingId} className="mb-4 text-lg font-semibold">
                {title}
              </h2>
              {mobile ? (
                <div
                  data-testid="mobile-frame"
                  className="mx-auto border"
                  style={{ width: MOBILE_FRAME_WIDTH }}
                >
                  <Gallery />
                </div>
              ) : (
                <Gallery />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
