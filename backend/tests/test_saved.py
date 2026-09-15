import unittest
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.saved import Identity, current_user

A = '11111111-1111-4111-8111-111111111111'
B = '22222222-2222-4222-8222-222222222222'


class SavedTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def authenticate(self, user_id=A):
        app.dependency_overrides[current_user] = lambda: Identity(user_id, 'verified-token')

    def test_all_private_routes_require_signin(self):
        for method, path in [('GET', '/api/bookmarks'), ('POST', '/api/bookmarks'),
                             ('DELETE', '/api/bookmarks/1'), ('GET', '/api/collections'),
                             ('POST', '/api/collections'), ('DELETE', '/api/collections/1')]:
            self.assertEqual(self.client.request(method, path).status_code, 401)

    def test_expired_token_is_rejected_by_auth_server(self):
        with patch('app.saved.configuration', return_value=('https://auth.example', 'public-key')), \
             patch('app.saved.requests.get', return_value=Mock(status_code=401)):
            response = self.client.get('/api/bookmarks', headers={'Authorization': 'Bearer forged'})
        self.assertEqual(response.status_code, 401)

    def test_identity_is_verified_not_taken_from_client(self):
        with patch('app.saved.configuration', return_value=('https://auth.example', 'public-key')), \
             patch('app.saved.requests.get', return_value=Mock(status_code=200, ok=True, json=lambda: {'id': A})) as auth, \
             patch('app.saved.database', return_value=[]) as db:
            response = self.client.get('/api/bookmarks', headers={'Authorization': 'Bearer signed-token'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(auth.call_args.kwargs['headers']['Authorization'], 'Bearer signed-token')
        self.assertEqual(db.call_args.kwargs['params']['user_id'], f'eq.{A}')

    def test_bookmark_upsert_is_owned_and_idempotent(self):
        self.authenticate()
        with patch('app.saved.database', return_value=[{'id': 1, 'user_id': A}]) as db:
            response = self.client.post('/api/bookmarks', json={'title': 'Story', 'url': 'https://example.org/story'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data']['id'], 1)
        self.assertEqual(db.call_args.kwargs['payload']['user_id'], A)
        self.assertEqual(db.call_args.kwargs['params']['on_conflict'], 'user_id,url')
        self.assertIn('merge-duplicates', db.call_args.kwargs['prefer'])

    def test_cannot_save_into_someone_elses_collection(self):
        self.authenticate()
        with patch('app.saved.database', return_value=[]) as db:
            response = self.client.post('/api/bookmarks', json={'title': 'Story', 'url': 'https://example.org/story', 'collection_id': 55})
        self.assertEqual(response.status_code, 404)
        db.assert_called_once()
        self.assertEqual(db.call_args.kwargs['params']['user_id'], f'eq.{A}')

    def test_delete_and_collection_reads_always_filter_owner(self):
        self.authenticate(B)
        with patch('app.saved.database', return_value=[]) as db:
            for method, path in [('DELETE', '/api/bookmarks/1'), ('DELETE', '/api/collections/1'), ('GET', '/api/collections')]:
                self.assertEqual(self.client.request(method, path).status_code, 200)
                self.assertEqual(db.call_args.kwargs['params']['user_id'], f'eq.{B}')

    def test_request_cannot_override_user_id_or_use_unsafe_link(self):
        self.authenticate()
        for payload in [{'title': 'Story', 'url': 'https://example.org', 'user_id': B},
                        {'title': 'Story', 'url': 'javascript:alert(1)'},
                        {'title': '  ', 'url': 'https://example.org'}]:
            self.assertEqual(self.client.post('/api/bookmarks', json=payload).status_code, 422)

    def test_saved_feed_pagination(self):
        self.authenticate()
        with patch('app.saved.database', return_value=[{'id': i} for i in range(21)]):
            data = self.client.get('/api/bookmarks?limit=20').json()
        self.assertEqual(len(data['data']), 20)
        self.assertTrue(data['has_more'])

    def test_database_forwards_user_token_not_service_authorization(self):
        from app.saved import database
        response = Mock(ok=True, content=b'[]', json=lambda: [])
        with patch('app.saved.configuration', return_value=('https://db.example', 'server-api-key')), \
             patch('app.saved.requests.request', return_value=response) as request:
            database('GET', 'upfeed_bookmarks', Identity(A, 'user-jwt'))
        self.assertEqual(request.call_args.kwargs['headers']['Authorization'], 'Bearer user-jwt')


if __name__ == '__main__':
    unittest.main()
