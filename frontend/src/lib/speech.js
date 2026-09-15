// Voice names vary by browser and operating system; there is no gender field.
export function selectVoice(voices, lang = 'en') {
  const candidates = voices.filter(v => v.lang.toLowerCase().split(/[-_]/)[0] === lang)
  const preferred = lang === 'hi'
    ? ['swara', 'aditi', 'lekha', 'veena', 'female']
    : ['jenny', 'aria', 'samantha', 'zira', 'ava', 'allison', 'susan', 'sonia', 'google uk english female', 'neerja', 'karen', 'moira', 'fiona', 'tessa', 'victoria', 'female']
  const ranked = candidates.map(voice => {
    const index = preferred.findIndex(name => voice.name.toLowerCase().includes(name))
    // Prefer US English to avoid switching to a strong regional accent.
    const accent = lang === 'en' && /^en[-_]US$/i.test(voice.lang) ? 200 : 0
    return { voice, score: index < 0 ? -1 : 100 - index + accent + (/natural|neural/i.test(voice.name) ? 50 : 0) }
  }).sort((a, b) => b.score - a.score)
  return ranked.find(item => item.score >= 0)?.voice || candidates.find(v => v.default) || candidates[0] || null
}

let cancelPending = () => {}
export function stopSpeech() {
  cancelPending()
  cancelPending = () => {}
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

export function speak(text, lang = 'en', onEnd) {
  stopSpeech()
  if (!('speechSynthesis' in window)) { onEnd?.(); return }
  const synth = window.speechSynthesis
  let timer
  let started = false
  const cleanup = () => {
    clearTimeout(timer)
    synth.removeEventListener('voiceschanged', start)
  }
  const start = () => {
    if (started) return
    started = true
    cleanup()
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = selectVoice(synth.getVoices(), lang)
    if (voice) utterance.voice = voice
    utterance.lang = voice?.lang || (lang === 'hi' ? 'hi-IN' : 'en-US')
    utterance.rate = 0.9
    utterance.pitch = 1
    utterance.onend = onEnd
    utterance.onerror = onEnd
    synth.speak(utterance)
  }
  cancelPending = () => { started = true; cleanup() }
  if (synth.getVoices().length) start()
  else {
    synth.addEventListener('voiceschanged', start)
    timer = setTimeout(start, 1500)
  }
}
