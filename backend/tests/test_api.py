import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.feed import _editions


class ApiTests(unittest.TestCase):
    def setUp(self):
        _editions.clear()
        self.client = TestClient(app)

    def test_feed_round_trip_and_cursor_scope(self):
        articles = [dict(url=f'https://example.org/{i}', title=f'Story {i}') for i in range(23)]
        with patch('app.main._fetch_fresh', return_value=articles):
            first = self.client.get('/api/news/technology').json()
            second = self.client.get('/api/news/technology', params={'page': 2, 'after': first['next_after']})
            self.assertEqual(second.status_code, 200)
            self.assertEqual(len(second.json()['data']), 3)
            wrong = self.client.get('/api/news/world', params={'page': 2, 'after': first['next_after']})
            self.assertEqual(wrong.status_code, 410)

    def test_search_pagination_uses_same_results(self):
        articles = [dict(url=f'https://example.org/{i}', title=f'Result {i}') for i in range(25)]
        with patch('app.main._search_sources', return_value=articles) as fetch:
            first = self.client.get('/api/search?q=space').json()
            second = self.client.get('/api/search', params={'q': 'space', 'page': 2, 'after': first['next_after']}).json()
            self.assertEqual(len(second['data']), 5)
            self.assertFalse(second['has_more'])
            fetch.assert_called_once()

    def test_validation_and_upstream_failure(self):
        self.assertEqual(self.client.get('/api/news/missing').status_code, 404)
        self.assertEqual(self.client.get('/api/news/technology?sort=bad').status_code, 422)
        self.assertEqual(self.client.get('/api/search?q=%20').status_code, 422)
        with patch('app.main._fetch_fresh', return_value=[]):
            self.assertEqual(self.client.get('/api/news/technology').status_code, 503)


if __name__ == '__main__':
    unittest.main()
