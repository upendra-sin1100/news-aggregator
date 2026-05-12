from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import requests

app = FastAPI()

# Allow React to communicate with FastAPI
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "UpFeed API is running perfectly!"}

@app.get("/api/news/{genre}")
def get_news(genre: str):
    # The secret bypass: just add .json to the subreddit URL!
    url = f"https://www.reddit.com/r/{genre}/hot.json?limit=15"
    
    # Reddit requires a custom User-Agent, otherwise they block it
    headers = {"User-Agent": "UpFeedApp/1.0"}
    
    response = requests.get(url, headers=headers)
    
    if response.status_code != 200:
        return {"status": "error", "message": "Failed to fetch from Reddit"}
        
    data = response.json()
    news_list = []
    
    for post in data['data']['children']:
        submission = post['data']
        # Check if it's not a text post and has an image
        if not submission.get('is_self') and 'preview' in submission:
            try:
                # The image URL has HTML encoding (&amp;), so we replace it
                image_url = submission['preview']['images'][0]['source']['url'].replace('&amp;', '&')
                news_list.append({
                    "id": submission['id'],
                    "title": submission['title'],
                    "url": "https://reddit.com" + submission['permalink'],
                    "image_url": image_url,
                    "source": f"r/{genre}"
                })
            except Exception:
                continue
                
    return {"status": "success", "data": news_list}