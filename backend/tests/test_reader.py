import json
import unittest
from unittest.mock import patch
from app.publishers import parse_feed
from app.reader import extract_page, validate_url


class ReaderTests(unittest.TestCase):
    def test_rss_uses_direct_link_largest_image_and_plain_description(self):
        xml = b'''<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Publisher</title><item>
        <title>Story</title><link>https://publisher.org/story</link>
        <description>&lt;p&gt;A useful description.&lt;/p&gt;</description>
        <pubDate>Mon, 14 Sep 2026 10:00:00 GMT</pubDate>
        <media:thumbnail width="140" url="https://cdn.org/small.jpg" />
        <media:content width="1000" url="https://cdn.org/large.jpg" />
        </item></channel></rss>'''
        article = parse_feed(xml, 'https://publisher.org/rss')[0]
        self.assertEqual(article['url'], 'https://publisher.org/story')
        self.assertEqual(article['image_url'], 'https://cdn.org/large.jpg')
        self.assertEqual(article['description'], 'A useful description.')
        self.assertEqual(article['published_at'], '2026-09-14T10:00:00+00:00')

    def test_jsonld_extraction_does_not_need_nltk(self):
        body = 'Scientists published new results from a detailed study of the atmosphere. ' * 8
        html = '<title>Science report</title><meta property="og:image" content="/hero.jpg"><script type="application/ld+json">' + json.dumps({'@graph': [{'articleBody': body}]}) + '</script>'
        result = extract_page('https://publisher.org/story', html)
        self.assertEqual(result['full_text'], body.strip())
        self.assertEqual(result['image_url'], 'https://publisher.org/hero.jpg')
        self.assertEqual(result['content_status'], 'full')
        self.assertTrue(result['ai_summary'])

    def test_semantic_article_fallback_when_newspaper_fails(self):
        paragraph = 'A detailed paragraph about the recent discovery and its implications for researchers. '
        html = '<title>Research</title><article>' + ''.join(f'<p>{paragraph}{i}</p>' for i in range(5)) + '</article>'
        with patch('app.reader.Article', side_effect=ValueError('parser failed')):
            result = extract_page('https://publisher.org/story', html)
        self.assertEqual(result['content_status'], 'full')
        self.assertIn(paragraph, result['full_text'])

    def test_metadata_only_is_an_honest_preview(self):
        with patch('app.reader.Article', side_effect=ValueError):
            result = extract_page('https://publisher.org/story', '<title>Story</title><meta name="description" content="Publisher introduction.">')
        self.assertEqual(result['content_status'], 'preview')
        self.assertIsNone(result['ai_summary'])
        self.assertEqual(result['full_text'], 'Publisher introduction.')

    def test_private_addresses_and_non_http_urls_rejected(self):
        for url in ['file:///etc/passwd', 'http://user:pass@example.org', 'https://example.org:1234']:
            with self.assertRaises(ValueError):
                validate_url(url)
        with patch('app.reader.socket.getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 80))]):
            with self.assertRaises(ValueError):
                validate_url('http://localhost/')


if __name__ == '__main__':
    unittest.main()
