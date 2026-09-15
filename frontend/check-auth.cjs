const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

const mockAuth = `
let session = JSON.parse(localStorage.getItem('test-session') || 'null');
const listeners = new Set();
function emit(){localStorage.setItem('test-session',JSON.stringify(session));listeners.forEach(fn=>fn(session?'SIGNED_IN':'SIGNED_OUT',session));}
const auth = {
 onAuthStateChange(fn){listeners.add(fn);queueMicrotask(()=>fn('INITIAL_SESSION',session));return {data:{subscription:{unsubscribe(){listeners.delete(fn)}}}}},
 async getSession(){return {data:{session},error:null}},
 async signUp(){return {data:{session:null},error:null}},
 async resend(){return {data:{},error:null}},
 async signInWithPassword({email,password}){
  if(password==='unconfirmed-password')return {error:{code:'email_not_confirmed',message:'Email not confirmed'}};
  if(password==='wrong-password')return {error:{message:'Invalid email or password'}};
  session={user:{id:email,email},access_token:'token-'+email};emit();return {data:{session},error:null};
 },
 async signOut(){session=null;emit();return {error:null}}
};
export default async function getSupabaseClient(){return {auth}};
export {getSupabaseClient};
`

;(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/src/lib/supabase.js*', route => route.fulfill({ contentType: 'application/javascript', body: mockAuth }))
  const stores = new Map()
  let failSave = true
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.pathname === '/api/article-preview') return route.fulfill({ json: { status: 'success', data: { image_url: null } } })
    if (url.pathname.startsWith('/api/news')) return route.fulfill({ json: { status: 'success', data: [{ id: 'story-1', title: 'A story worth keeping', url: 'https://example.org/story', description: 'A useful description.', source: 'Test publisher' }], has_more: false } })
    if (url.pathname === '/api/read') return route.fulfill({ json: { status: 'success', data: { title: 'A story worth keeping', full_text: 'A useful description.', ai_summary: 'A useful summary.', content_status: 'full' } } })
    const authorization = req.headers().authorization
    if (!authorization) return route.fulfill({ status: 401, json: { detail: 'Sign in first.' } })
    const owner = authorization.replace('Bearer token-', '')
    if (!stores.has(owner)) stores.set(owner, { bookmarks: [], collections: [] })
    const store = stores.get(owner)
    if (url.pathname === '/api/collections') {
      if (req.method() === 'POST') {
        const item = { id: 7, ...req.postDataJSON() }
        store.collections.push(item)
        return route.fulfill({ json: { status: 'success', data: item } })
      }
      return route.fulfill({ json: { status: 'success', data: store.collections } })
    }
    if (req.method() === 'DELETE') {
      const id = Number(url.pathname.split('/').at(-1))
      if (url.pathname.startsWith('/api/collections/')) {
        store.collections = store.collections.filter(c => c.id !== id)
        store.bookmarks = store.bookmarks.map(a => a.collection_id === id ? { ...a, collection_id: null } : a)
      } else store.bookmarks = store.bookmarks.filter(a => a.id !== id)
      return route.fulfill({ json: { status: 'success' } })
    }
    if (req.method() === 'POST') {
      if (failSave) { failSave = false; return route.fulfill({ status: 503, json: { detail: 'Temporary save failure. Try again.' } }) }
      const item = { ...req.postDataJSON(), id: 1 }
      store.bookmarks = [item]
      return route.fulfill({ json: { status: 'success', data: item } })
    }
    const items = store.bookmarks.filter(a => !url.searchParams.has('collection_id') || String(a.collection_id) === url.searchParams.get('collection_id'))
    return route.fulfill({ json: { status: 'success', data: items, has_more: false } })
  })
  const signIn = async email => {
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill('correct-password')
    await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click()
  }
  await page.goto('http://127.0.0.1:5173')
  await page.locator('.card').first().click()
  const reader = page.getByRole('dialog', { name: 'Article reader', exact: true })
  await reader.getByRole('button', { name: '⊙ Save', exact: true }).click()
  await page.getByRole('dialog', { name: 'Welcome back.' }).waitFor()
  await page.getByRole('button', { name: 'New here? Create an account' }).click()
  await page.getByLabel('Email', { exact: true }).fill('reader@example.org')
  await page.getByLabel('Password', { exact: true }).fill('correct-password')
  await page.getByLabel('Confirm password', { exact: true }).fill('different-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByText('Passwords do not match. Please enter them again.').waitFor()
  await page.getByLabel('Confirm password', { exact: true }).fill('correct-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByText('Check your email to confirm your account, then sign in here.').waitFor()
  await page.getByLabel('Password', { exact: true }).fill('unconfirmed-password')
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByText('Confirm your email before signing in.', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Resend confirmation email', exact: true }).click()
  await page.getByText('If this account needs confirmation', { exact: false }).waitFor()
  await page.getByLabel('Password', { exact: true }).fill('wrong-password')
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByText('Invalid email or password').waitFor()
  await signIn('reader@example.org')
  const picker = page.getByRole('dialog', { name: 'Save article', exact: true })
  await picker.waitFor()
  await picker.getByRole('button', { name: /Save as is/ }).click()
  await picker.getByRole('alert').waitFor()
  await picker.getByRole('button', { name: /Save as is/ }).click()
  await picker.waitFor({ state: 'hidden' })
  await reader.waitFor()
  await reader.locator('.modal__close').click()
  await page.getByRole('button', { name: 'Saved — change collection', exact: true }).waitFor()
  assert.equal(stores.get('reader@example.org').bookmarks.length, 1)
  await page.getByRole('button', { name: 'Saved — change collection', exact: true }).click()
  await picker.getByRole('button', { name: /Make a collection/ }).click()
  await picker.getByPlaceholder('New collection name…').fill('Weekend')
  await picker.getByRole('button', { name: '+ Create', exact: true }).click()
  await picker.getByRole('button', { name: 'Weekend', exact: true }).click()
  await picker.waitFor({ state: 'hidden' })
  assert.equal(stores.get('reader@example.org').bookmarks.length, 1)
  assert.equal(stores.get('reader@example.org').bookmarks[0].collection_id, 7)
  await page.getByRole('button', { name: 'Saved', exact: true }).click()
  await page.locator('.card').filter({ hasText: 'A story worth keeping' }).waitFor()
  await page.getByRole('button', { name: 'Weekend', exact: true }).click()
  await page.locator('.card').waitFor()
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Delete collection Weekend', exact: true }).click()
  assert.equal(stores.get('reader@example.org').collections.length, 1)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Delete collection Weekend', exact: true }).click()
  await page.getByRole('button', { name: 'Delete collection Weekend', exact: true }).waitFor({ state: 'hidden' })
  await page.locator('.card').waitFor()
  assert.equal(stores.get('reader@example.org').collections.length, 0)
  assert.equal(stores.get('reader@example.org').bookmarks[0].collection_id, null)
  await page.goto('http://127.0.0.1:5173/?welcome=1')
  await page.getByText('Welcome to your reading room.', { exact: true }).waitFor()
  await page.getByRole('button', { name: /Start reading/ }).click()
  assert.equal(new URL(page.url()).searchParams.has('welcome'), false)
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Saved', exact: true }).click()
  await page.locator('.card').waitFor()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('button', { name: 'Sign in to view saved stories' }).waitFor()
  assert.equal(await page.locator('.card').count(), 0)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await signIn('another@example.org')
  await page.getByText('Your reading list starts here.', { exact: false }).waitFor()
  assert.equal(await page.locator('.card').count(), 0)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await signIn('reader@example.org')
  await page.locator('.card').waitFor()
  await page.getByRole('button', { name: /Remove/ }).click()
  await page.locator('.card').waitFor({ state: 'hidden' })
  assert.equal(stores.get('reader@example.org').bookmarks.length, 0)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.deepEqual(errors, [])
  console.log('PASS: guest save, signup confirmation, invalid login, pending save, failed-save retry, duplicate protection, collection save, restored session, sign-out, account isolation, removal and mobile layout.')
  await browser.close()
})().catch(error => { console.error(error); process.exit(1) })
