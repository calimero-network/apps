import { toast } from 'sonner';

export async function copyLink(url: string, message = 'Link copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success(message);
  } catch {
    toast.error("Couldn't copy link");
  }
}
