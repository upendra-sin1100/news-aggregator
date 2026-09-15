"""Authenticated saved stories. Every request uses the user's JWT and RLS."""
import os
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID
import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, HttpUrl

router = APIRouter(prefix='/api')
bearer = HTTPBearer(auto_error=False)


def configuration():
    url = os.getenv('SUPABASE_URL') or os.getenv('VITE_SUPABASE_URL', '')
    key = (os.getenv('SUPABASE_PUBLISHABLE_KEY') or os.getenv('SUPABASE_ANON_KEY')
           or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY'))
    if not url or not key:
        raise HTTPException(503, 'Account storage is not configured on the server.')
    return url.rstrip('/'), key


@dataclass(frozen=True)
class Identity:
    user_id: str
    token: str


def current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    if not credentials or credentials.scheme.lower() != 'bearer':
        raise HTTPException(401, 'Sign in to access your saved stories.', headers={'WWW-Authenticate': 'Bearer'})
    url, key = configuration()
    try:
        response = requests.get(f'{url}/auth/v1/user',
            headers={'apikey': key, 'Authorization': f'Bearer {credentials.credentials}'}, timeout=10)
        if response.status_code in (401, 403):
            raise HTTPException(401, 'Your session expired. Please sign in again.')
        if not response.ok:
            raise HTTPException(503, 'Sign-in verification is temporarily unavailable.')
        user_id = str(UUID(response.json()['id']))
        return Identity(user_id, credentials.credentials)
    except (requests.RequestException, ValueError, KeyError):
        raise HTTPException(503, 'Sign-in verification is temporarily unavailable.') from None


def database(method, table, user, *, params=None, payload=None, prefer=None):
    url, key = configuration()
    headers = {'apikey': key, 'Authorization': f'Bearer {user.token}',
               'Content-Type': 'application/json', 'Prefer': prefer or 'return=representation'}
    try:
        response = requests.request(method, f'{url}/rest/v1/{table}', headers=headers,
            params=params, json=payload, timeout=12)
    except requests.RequestException:
        raise HTTPException(503, 'Saved stories are temporarily unavailable. Please try again.') from None
    if not response.ok:
        if response.status_code == 401:
            raise HTTPException(401, 'Your session expired. Please sign in again.')
        if response.status_code == 403:
            raise HTTPException(403, 'You do not have permission to change this item.')
        if response.status_code == 409:
            raise HTTPException(409, 'This item already exists or its collection was removed. Please refresh and try again.')
        raise HTTPException(503, 'Could not access saved stories. Check that the database setup SQL has been applied.')
    return response.json() if response.content else []


class BookmarkRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=1000)
    url: HttpUrl = Field(max_length=2000)
    image_url: HttpUrl | None = None
    ai_summary: str | None = Field(default=None, max_length=10000)
    description: str | None = Field(default=None, max_length=10000)
    source: str | None = Field(default=None, max_length=300)
    published_at: datetime | None = None
    collection_id: int | None = Field(default=None, gt=0)


class CollectionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=80)
    color: str = Field(default='#c4451e', pattern=r'^#[0-9a-fA-F]{6}$')


@router.get('/bookmarks')
def get_bookmarks(collection_id: int | None = Query(default=None, gt=0),
                  page: int = Query(default=1, ge=1), limit: int = Query(default=100, ge=1, le=100),
                  user: Identity = Depends(current_user)):
    params = {'select': '*', 'user_id': f'eq.{user.user_id}', 'order': 'created_at.desc,id.desc',
              'offset': (page - 1) * limit, 'limit': limit + 1}
    if collection_id is not None:
        params['collection_id'] = f'eq.{collection_id}'
    rows = database('GET', 'upfeed_bookmarks', user, params=params)
    more = len(rows) > limit
    return {'status': 'success', 'data': rows[:limit], 'has_more': more, 'next_page': page + 1 if more else None}


@router.post('/bookmarks')
def save_bookmark(req: BookmarkRequest, user: Identity = Depends(current_user)):
    if req.collection_id is not None:
        collection = database('GET', 'upfeed_collections', user,
            params={'id': f'eq.{req.collection_id}', 'user_id': f'eq.{user.user_id}', 'select': 'id'})
        if not collection:
            raise HTTPException(404, 'This collection is unavailable. Please choose another.')
    payload = req.model_dump(mode='json')
    payload['user_id'] = user.user_id
    rows = database('POST', 'upfeed_bookmarks', user, payload=payload,
        params={'on_conflict': 'user_id,url'}, prefer='resolution=merge-duplicates,return=representation')
    if not rows:
        raise HTTPException(503, 'The story was not saved. Please try again.')
    return {'status': 'success', 'data': rows[0]}


@router.delete('/bookmarks/{bookmark_id}')
def delete_bookmark(bookmark_id: int, user: Identity = Depends(current_user)):
    database('DELETE', 'upfeed_bookmarks', user,
        params={'id': f'eq.{bookmark_id}', 'user_id': f'eq.{user.user_id}'})
    return {'status': 'success'}


@router.get('/collections')
def get_collections(user: Identity = Depends(current_user)):
    rows = database('GET', 'upfeed_collections', user,
        params={'user_id': f'eq.{user.user_id}', 'select': '*', 'order': 'created_at.asc,id.asc'})
    return {'status': 'success', 'data': rows}


@router.post('/collections')
def create_collection(req: CollectionRequest, user: Identity = Depends(current_user)):
    rows = database('POST', 'upfeed_collections', user,
        payload={**req.model_dump(), 'user_id': user.user_id}, params={'on_conflict': 'user_id,name'},
        prefer='resolution=merge-duplicates,return=representation')
    if not rows:
        raise HTTPException(503, 'The collection was not created. Please try again.')
    return {'status': 'success', 'data': rows[0]}


@router.delete('/collections/{collection_id}')
def delete_collection(collection_id: int, user: Identity = Depends(current_user)):
    database('DELETE', 'upfeed_collections', user,
        params={'id': f'eq.{collection_id}', 'user_id': f'eq.{user.user_id}'})
    return {'status': 'success'}
