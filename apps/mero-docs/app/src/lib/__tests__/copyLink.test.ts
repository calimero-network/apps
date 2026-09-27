import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { copyLink } from '../copyLink';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe('copyLink', () => {
  it('writes the URL and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await copyLink('http://x/app/w');
    expect(writeText).toHaveBeenCalledWith('http://x/app/w');
    expect(toast.success).toHaveBeenCalledWith('Link copied');
  });

  it('says so when the clipboard refuses', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    await copyLink('http://x/app/w');
    expect(toast.error).toHaveBeenCalledWith("Couldn't copy link");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
