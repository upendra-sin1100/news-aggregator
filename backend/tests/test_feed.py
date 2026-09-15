import unittest
from unittest.mock import Mock, patch
from fastapi import HTTPException
from app import feed


def story(i, published=None):
    return dict(url=f'https://example.org/{i}', title=f'Story {i}', published_at=published)


class EditionTests(unittest.TestCase):
    def setUp(self):
        feed._editions.clear()

    def test_scroll_is_stable_and_stops_at_end(self):
        fetch = Mock(return_value=[story(i) for i in range(45)])
        first = feed.edition('tech', fetch)
        second = feed.edition('tech', fetch, page=2, after=first['next_after'])
        third = feed.edition('tech', fetch, page=3, after=second['next_after'])
        self.assertEqual([len(p['data']) for p in [first, second, third]], [20, 20, 5])
        self.assertEqual(len({a['url'] for p in [first, second, third] for a in p['data']}), 45)
        self.assertFalse(third['has_more'])
        self.assertIsNone(third['next_page'])
        fetch.assert_called_once()

    def test_refresh_does_not_change_existing_reader_pages(self):
        fetch = Mock(return_value=[story(i) for i in range(30)])
        old = feed.edition('tech', fetch)
        fetch.return_value = [story(i) for i in range(100, 130)]
        new = feed.edition('tech', fetch, refresh=True)
        continuation = feed.edition('tech', fetch, page=2, after=old['next_after'])
        self.assertEqual(new['data'][0]['title'], 'Story 100')
        self.assertEqual(continuation['data'][0]['title'], 'Story 20')

    def test_cache_expires_after_five_minutes(self):
        fetch = Mock(return_value=[story(1)])
        with patch.object(feed, 'monotonic', return_value=0):
            feed.edition('tech', fetch)
        with patch.object(feed, 'monotonic', return_value=299):
            self.assertTrue(feed.edition('tech', fetch)['from_cache'])
        with patch.object(feed, 'monotonic', return_value=301):
            self.assertFalse(feed.edition('tech', fetch)['from_cache'])
        self.assertEqual(fetch.call_count, 2)

    def test_cursor_rejects_wrong_scope_and_expired_editions(self):
        first = feed.edition('tech', lambda: [story(i) for i in range(30)])
        for scope, token in [('world', first['next_after']), ('tech', 'expired')]:
            with self.assertRaises(HTTPException) as error:
                feed.edition(scope, lambda: [], page=2, after=token)
            self.assertEqual(error.exception.status_code, 410)

    def test_deduplication_and_real_publication_order(self):
        articles = [story(1, '2026-09-14T10:00:00+05:30'), story(2, '2026-09-14T06:00:00Z'), story(1), story(3)]
        result = feed.edition('latest', lambda: articles, latest=True)
        self.assertEqual([a['title'] for a in result['data']], ['Story 2', 'Story 1', 'Story 3'])

    def test_unavailable_sources_are_retryable_and_not_cached(self):
        with self.assertRaises(HTTPException) as error:
            feed.edition('tech', lambda: [])
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(len(feed._editions), 0)

    def test_empty_search_is_valid(self):
        result = feed.edition('search:missing', lambda: [], allow_empty=True)
        self.assertEqual(result['data'], [])
        self.assertFalse(result['has_more'])



if __name__ == '__main__':
    unittest.main()
