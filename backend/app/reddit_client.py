import os
from praw import Reddit
from dotenv import load_dotenv

load_dotenv()

reddit = Reddit(
    client_id=os.getenv("REDDIT_CLIENT_ID"),
    client_secret=os.getenv("REDDIT_CLIENT_SECRET"),
    user_agent="NexusNews/0.1 by Upendra"
)

def fetch_reddit_news(category: str):
    # Mapping "Tech" to "technology", etc.
    subreddit = reddit.subreddit(category)
    news_list = []
    
    for submission in subreddit.hot(limit=15):
        # We only want posts with actual images/links, not just text
        if not submission.is_self and hasattr(submission, 'preview'):
            news_list.append({
                "id": submission.id,
                "title": submission.title,
                "url": submission.url,
                "thumbnail": submission.preview['images'][0]['source']['url'],
                "author": str(submission.author),
                "created_at": submission.created_utc
            })
    return news_list