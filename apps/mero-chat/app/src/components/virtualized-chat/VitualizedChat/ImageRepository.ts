import { log } from '../../../utils/logger';

class ImageRepository {
  private memCache: Map<string, string> = new Map<string, string>();

  private fetchCacheImage: (accountId: string) => Promise<string | null>;

  constructor(fetchCacheImage: (accountId: string) => Promise<string | null>) {
    this.fetchCacheImage = fetchCacheImage;
  }

  async getCacheImage(accountId: string): Promise<string | null> {
    if (this.memCache.has(accountId)) {
      return this.memCache.get(accountId) as string;
    } else {
      try {
        const image = await this.fetchCacheImage(accountId);
        this.memCache.set(accountId, image || '');
        return image;
      } catch (error) {
        log.error('ImageRepository', 'Error fetching image', error);
        return null;
      }
    }
  }
}

export default ImageRepository;
