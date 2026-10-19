import { Bookmark } from '../../types';
import { request } from '../../services/api';
export const bookmarksApi = {
  async getBookmarks(): Promise<Bookmark[]> {
    return request<Bookmark[]>('/api/bookmarks');
  },

  async createBookmark(payload: { title: string; url: string; icon?: string; category?: string }): Promise<Bookmark> {
    return request<Bookmark>('/api/bookmarks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deleteBookmark(id: string): Promise<void> {
    return request(`/api/bookmarks/${id}`, { method: 'DELETE' });
  },
};
