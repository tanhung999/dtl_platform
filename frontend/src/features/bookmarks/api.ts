import { Bookmark } from '../../types';
import { requestWithTimeout } from '../../services/requestTimeout';
export const bookmarksApi = {
  async getBookmarks(signal?: AbortSignal): Promise<Bookmark[]> {
    return requestWithTimeout<Bookmark[]>('/api/bookmarks', { signal, cache: 'no-store' });
  },

  async createBookmark(payload: { title: string; url: string; icon?: string; category?: string; client_request_id?: string }): Promise<Bookmark> {
    return requestWithTimeout<Bookmark>('/api/bookmarks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deleteBookmark(id: string): Promise<void> {
    return requestWithTimeout(`/api/bookmarks/${id}`, { method: 'DELETE' });
  },
};
