from uuid import uuid4
from tests.support.api_case import ApiTestCase


class BookmarkProfileTests(ApiTestCase):
    async def test_bookmark_validation_and_owner_boundaries(self):
        for fields in ({'title': '  '}, {'title': 'x'*121}, {'url': 'javascript:alert(1)'},
                       {'url': 'data:text/html,test'}, {'url': 'https://user:secret@example.com'},
                       {'url': 'https://'}, {'url': 'https://example.com/'+'x'*500},
                       {'category': 'x'*81}, {'icon': 'x'*51}):
            code, _ = await self.request('POST', '/api/bookmarks', payload={'title':'Link', 'url':'https://example.com', **fields})
            self.assertEqual(code, 422, fields)
        code, bookmark = await self.request('POST', '/api/bookmarks', payload={'title':' Link ', 'url':'https://example.com'})
        self.assertEqual(code, 201, bookmark)
        self.assertEqual(bookmark['title'], 'Link')
        self.assertEqual(bookmark['url'], 'https://example.com/')
        self.assertFalse(bookmark['is_global'])
        self.assertEqual((await self.request('GET', '/api/bookmarks', user='bob'))[1], [])
        self.assertEqual((await self.request('DELETE', '/api/bookmarks/'+bookmark['id'], user='bob'))[0], 404)

    async def test_bookmark_retry_is_idempotent_and_cannot_recreate_deleted_link(self):
        payload = {'title':'Retry', 'url':'https://example.com', 'client_request_id':str(uuid4())}
        code, first = await self.request('POST', '/api/bookmarks', payload=payload)
        self.assertEqual(code, 201, first)
        self.assertEqual((await self.request('POST', '/api/bookmarks', payload=payload))[1]['id'], first['id'])
        self.assertEqual(len((await self.request('GET', '/api/bookmarks'))[1]), 1)
        self.assertEqual((await self.request('POST', '/api/bookmarks', payload={**payload, 'title':'Other'}))[0], 409)
        self.assertEqual((await self.request('DELETE', '/api/bookmarks/'+first['id']))[0], 204)
        self.assertEqual((await self.request('POST', '/api/bookmarks', payload=payload))[0], 410)

    async def test_profile_rejects_blank_name_and_database_overflow_without_partial_writes(self):
        initial = (await self.request('GET', '/api/auth/me'))[1]
        for fields in ({'full_name':'  '}, {'full_name':'x'*121}, {'phone':'x'*31},
                       {'job_title':'x'*101}, {'office_location':'x'*151}, {'bio':'x'*10001}):
            code, _ = await self.request('PUT', '/api/auth/profile', payload={'full_name':'Changed', **fields})
            self.assertEqual(code, 422, fields.keys())
            self.assertEqual((await self.request('GET', '/api/auth/me'))[1]['full_name'], initial['full_name'])
        code, row = await self.request('PUT', '/api/auth/profile', payload={'full_name':'  Alice Updated  ', 'phone':' 123 ', 'bio':''})
        self.assertEqual(code, 200, row)
        self.assertEqual(row['full_name'], 'Alice Updated')
        self.assertEqual(row['phone'], '123')

    async def test_profile_cannot_change_organization_assignment(self):
        code, _ = await self.request('PUT', '/api/auth/profile', payload={'job_title':'Tự đặt chức danh'})
        self.assertEqual(code, 403)
        code, _ = await self.request('PUT', '/api/auth/profile', payload={'position_id':str(uuid4())})
        self.assertEqual(code, 403)
