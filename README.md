# YoEcho — Netlify PWA Deployment Guide

## What's Inside This Package

```
yoecho-netlify/
├── public/                  ← Everything Netlify serves to users
│   ├── index.html           ← App entry point (PWA shell)
│   ├── app.jsx              ← Your full YoEcho app (modified)
│   ├── manifest.json        ← PWA manifest (install to home screen)
│   ├── sw.js                ← Service worker (offline support)
│   └── icons/               ← App icons
│       ├── icon-192.png
│       └── icon-512.png
├── netlify/
│   └── functions/
│       ├── chat.js          ← AI proxy: Gemini + Groq fallback (hides your keys)
│       └── db.js            ← Supabase sync proxy
├── netlify.toml             ← Netlify build config
└── README.md                ← This file
```

## AI Setup — Gemini (brain) + Groq (fallback)

`netlify/functions/chat.js` tries **Gemini** first. If Gemini fails, it falls back to **Groq**.
Each provider has an ordered list of models, because model names get retired often:

| Situation | What happens |
|-----------|--------------|
| Model retired / not found (404, 400) | Try the next model in that provider's list |
| Rate limit (429), bad key, timeout, 5xx, blocked/empty reply | Move to the next provider |
| Everything fails | Returns 503 (or 429) and the browser console prints the real reason |

Default models: Gemini `gemini-3.8-flash` → `gemini-3.6-flash` → `gemini-flash-latest` → `gemini-2.5-flash`;
Groq `openai/gpt-oss-120b` → `openai/gpt-oss-20b`.

### Keys
1. Gemini: https://aistudio.google.com/apikey  (no billing needed for the free tier)
2. Groq: https://console.groq.com/keys

### Netlify environment variables
| Name | Required | Notes |
|------|----------|-------|
| `GEMINI_API_KEY` | yes | |
| `GROQ_API_KEY` | yes | |
| `GEMINI_MODEL` | no | Comma-separated list, overrides defaults. Delete old values! |
| `GROQ_MODEL` | no | Comma-separated list, overrides defaults. Delete old values! |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | for cloud sync | used by `netlify/functions/db.js` |

Remove the old `OPENROUTER_API_KEY` — it is no longer used.
Environment variables only take effect after a **new deploy**.

### When a model stops working
Model names change. Check https://ai.google.dev/gemini-api/docs/deprecations and
https://console.groq.com/docs/deprecations, then update `GEMINI_MODEL` / `GROQ_MODEL` in Netlify and redeploy.
Open the browser console: a failure prints lines like `Gemini gemini-3.8-flash HTTP 404: ...`,
and a success prints `reply via gemini (model-name)`. The chat header also shows `AI · GEMINI` or `AI · GROQ`.

### Privacy note
Google's free Gemini tier may use prompts and replies to improve its models. YoEcho handles
personal journals and reflections, so tell users, or use a paid key before a public launch.

## Step-by-Step: Deploy to Netlify

### Step 1 — Upload Your Project
**Option A — Drag & Drop (easiest):**
1. Go to **https://app.netlify.com**
2. Sign up / log in (free)
3. Drag the entire `yoecho-netlify` folder onto the Netlify dashboard
4. Netlify auto-detects `netlify.toml` and deploys

**Option B — GitHub (recommended for updates):**
1. Push this folder to a GitHub repo
2. In Netlify: **"Add new site" → "Import from Git"**
3. Connect your GitHub and select the repo
4. Build settings are auto-read from `netlify.toml`
5. Click **Deploy**

### Step 2 — Add Your API Key (CRITICAL)
This is how Netlify keeps your key secret from users:

1. In Netlify, go to your site dashboard
2. Click **"Site configuration"** (left sidebar)
3. Click **"Environment variables"**
4. Click **"Add a variable"**
5. Fill in:
   - **Key:** `OPENROUTER_API_KEY`
   - **Value:** `sk-or-v1-your-copied-key-here`
6. Click **Save**
7. Go to **Deploys** → click **"Trigger deploy"** → **"Deploy site"**
   (Environment variables only take effect after a new deploy)

### Step 3 — Test Your Deployment
1. Open your Netlify URL (e.g. `https://amazing-name-12345.netlify.app`)
2. The app should load with the amber/gold YoEcho interface
3. Type a message and wait for a response from Gemma 3 27B
4. If it responds ✅ — you're live!

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| App loads but AI doesn't respond | Check `GEMINI_API_KEY` and `GROQ_API_KEY` are set, redeploy, then read the console error |
| "Function not found" error | Make sure `netlify/functions/chat.js` is in the right folder |
| Responses are slow | Normal for free models — Gemma 3 27B may take 5-15 seconds |
| Rate limit error | Free models have limits. Wait a few minutes and try again |
| Storage not saving | Check browser allows localStorage (disable incognito or restrictions) |

---

## Update the Netlify Function URL (optional)

Open `netlify/functions/chat.js` and update line:
```js
"HTTP-Referer": "https://yoecho.netlify.app",
```
Replace with your actual Netlify URL after deployment.

---

## Installing as a PWA (Add to Home Screen)

**On Android (Chrome):**
1. Open the app in Chrome
2. Tap the 3-dot menu → "Add to Home screen"
3. Tap "Add"

**On iPhone (Safari):**
1. Open the app in Safari
2. Tap the Share icon (box with arrow)
3. Scroll down → "Add to Home Screen"
4. Tap "Add"

The app will now appear on your home screen like a native app!

---

## Built by Steven Sema — SayMyTech Developers, Kampala Uganda

---

## 3D Face (Face to face mode)

Open voice mode (the 🎙 button) and YoEcho appears with a 3D face that lip-syncs to its voice,
reacts to its mood, looks attentive while you speak and thinks before it answers. It works in
every mode that has voice (chat, wiser self, journal, debate, tutor).

```
public/
├── echo-face.js        ← face engine (lip-sync, emotions, gestures, blinking, gaze)
├── avatars/f1.glb      ← rigged avatar, dark hair  (gzip-packed: 0.8 MB, 2.3 MB unpacked)
├── avatars/f2.glb      ← rigged avatar, black hair (gzip-packed: 0.7 MB, 2.2 MB unpacked)
└── vendor/
    ├── three.min.js    ← Three.js r128 (MIT, see THREE-LICENSE.txt)
    └── GLTFLoader.js   ← GLB loader matching r128
```

- **Lazy-loaded.** Nothing above downloads until someone opens voice mode, so the first load of
  the app is unchanged. After the first use the service worker caches it for offline use.
- **Fallback.** No WebGL, a failed download, or a tap on `○ ORB` shows the original orb.
- **Look.** `✦ LOOK` in voice mode switches avatar and skin tone. Choices are remembered
  (`localStorage` key `yoecho_face_prefs`).
- **Lip-sync.** Words are turned into mouth shapes (a pronunciation layer in `echo-face.js`) and timed
  from the browser's spoken-word events, so the lips re-lock to every word. Voices that give no word
  events fall back to estimated timing, and the speed is learned per voice. Open `✦ LOOK` to
  slide the lip delay (lips before the voice → slide right) and press `▶ TEST LIPS`; the panel also shows
  whether the current voice is word-locked or estimated.
- **Body language.** What Echo says decides how it moves. A lexicon turns words into cues (greeting,
  emphasis, negation, size, uncertainty, thanks/sorry, counting, calm…) and each cue becomes an arm
  gesture, facial expression, head move or glance scheduled on the word-locked timeline, so the stroke
  lands on the word. Arms are placed by two-bone IK, hands have real finger shapes and palm
  orientation, and a collision guard measured on the avatar's actual mesh keeps hands out of each other,
  the torso and the face. To add a gesture, add an entry to `GEST` in `echo-face.js` (wrist position and palm
  direction); to teach it a word, add the word to a cue with `addCue(...)`.
- **Framing.** `✦ LOOK` → `WITH HANDS` (default, shows face and hands) or `CLOSE-UP`.
- **Speed.** The face files start downloading while the chat is open, the face is built in the
  background, and it stays warm when you close voice mode, so opening it is near-instant.
- **Adding a new avatar.** It needs a standard humanoid skeleton (Hips, Spine, Neck, Head, arms)
  and ARKit + Oculus viseme blendshapes (Ready Player Me avatars work). Pack it with `gzip -9 -n -c my.glb > public/avatars/my.glb`, put it in
  `public/avatars/` and add it to `AVATARS` in `echo-face.js` and `FACE_AVATARS` in `index.html`.
  Draco/meshopt/KTX2-compressed files are not supported by the bundled loader.

## Music (YoEcho plays you music)

`public/echo-music.js` is a self-contained generative music engine (Web Audio, no samples, no network). Echo decides *what* to play by ending a reply with a `MUSIC:{...}` tag (mood, intent `match|lift|calm`, optional style/energy); the engine composes an endless, non-repeating piece for it on the device.

- Lazy-loaded from `index.html` after the app is idle (skipped on data saver / 2G).
- Ask in chat ("play me something calm", "another one", "more energy", "stop the music") or open **Music** from the menu / the ♫ button.
- The music ducks while Echo speaks and goes silent while the mic is listening.
- Chat music cards are not saved with the chat history (the music itself is regenerable from a seed).
- **DJ mixes**: ask for "a 30 minute afrobeats mix" or "a chill DJ set". Tracks are planned so tempos stay close, each handover is beat-matched and phrase-aligned, moves to a related key, swaps the bass (high-pass sweep) and uses risers/impacts. Console: `EchoMusic.mix({styles:["afrobeats","amapiano","house"],minutes:20,shape:"build",trans:"blend"})`, `EchoMusic.mixNext()`, `EchoMusic.renderMix(opts, seconds)` (offline).
- **Solo performances**: ask for "solo piano" or "a sax solo". Piano, keys, guitar, kalimba, marimba and bells play melody, chords and bass themselves; sax, violin, flute and brass play an expressive single line over a faint bed. No drums, wider room, natural rubato. Console: `EchoMusic.play({solo:"violin",mood:"love"})`.
- Console API for tuning: `EchoMusic.play({mood:"joy",style:"afrobeats"})`, `EchoMusic.exportWav(brief, seconds)`.

## Reminders, time awareness and push notifications

YoEcho knows the current date, time and time zone. It sets reminders on its own from conversation: if you mention something coming up ("I have a dentist appointment Thursday"), it asks for any missing detail (usually just the time), saves it, and nudges you at the right moment. Explicit requests ("remind me Friday at 3 to call mum"), moving and cancelling by chat all work too. Reminders show in menu → **Reminders**, where people can also add them by hand and turn on phone notifications and gentle check-ins.

**One-time setup (needed for notifications when the app is closed)**
1. The notification tables already exist in the Supabase project **yoecho-push** (created for this; the same SQL is in `supabase-push.sql` if you ever need to recreate it).
2. In Netlify → Site settings → Environment variables add two variables: `PUSH_SUPABASE_URL` = `https://iriomiqchwcuctbnfhpd.supabase.co` and `PUSH_SUPABASE_KEY` = that project's **anon** key (Supabase → yoecho-push → Project Settings → API → *anon* key). These are kept server-side only. For tighter privacy you can instead use the *service_role* key and remove the "yoecho server access" policies.
3. Redeploy. The function `push-cron` runs every 2 minutes (set in `netlify.toml`) and sends due reminders and check-ins. Scheduled functions run on published deploys; the notification keys (VAPID) are generated automatically on first use.
4. Open YoEcho → menu → Reminders → **Turn on**, then **Send a test**.

Notes: on iPhone, YoEcho must first be added to the Home Screen (iOS 16.4+). Without the setup above, reminders still work as in-app alerts while YoEcho is open. Check-ins are opt-in, daytime only in the person's own time zone, spaced out, and skipped if they were just in the app. Push can arrive a minute or two late; it is not meant for anything time-critical like medication.

## Music: genre bands (v7)

Besides afrobeats, amapiano, lo-fi, house, trap, R&B, ambient, cinematic and acoustic, the engine now plays real **band genres**, each with its own chords, groove, bass line, lead style and instrument "band":

| Genre | What makes it that genre |
|---|---|
| Rock and Roll | shuffle feel, 12-bar blues changes, rhythm guitar/piano "5-6" boogie, boogie-woogie bass, sax/guitar blues licks |
| Rock | straight 8ths, power chords (palm-muted chugs, riffs), driving bass, pentatonic lead guitar, big fills + crashes |
| Blues | slow shuffle, 12-bar (major, minor, quick-change), blues-scale licks with bends, organ |
| Jazz | swing ride + hi-hat chick, walking bass, rootless 7th/9th/13th piano comping, bebop lines on sax/trumpet/vibes, head-solo-trade form |
| Reggae | one-drop, off-beat guitar skank, organ bubble, melodic bass |
| Funk | 16th-note clavinet/guitar chops with ghost notes, syncopated bass, horn stabs, ghost-note snare |
| Pop | four-chord progressions, bands of piano/guitar/synth/strings |
| Hip-hop | boom-bap kit, swung 16ths, minor-7th loops, vinyl |

New instruments: electric guitar (`eguitar`), distorted guitar (`dguitar`), lead guitar (`lguitar`), electric bass (`ebass`), upright bass (`upbass`), Hammond organ (`hammond`), `horns`, `clav`. New drum voices: ride, tambourine, cowbell, pedal hi-hat.

**Drum solos**: `{"solo":"drums","style":"rock"}` plays continuous drums (no breaks), with fills, ghost notes and percussion layers that change every few bars.

Every piece also picks a band (a set of instruments that belong together) and one of several progressions, grooves, bass lines and song forms per seed, so pieces differ much more than before.

## AI composer (v8)

When you ask for music, Echo (the chat model) now writes a **composition plan** as JSON: key, tempo, genre, band, a hook (motif) and a list of sections, each with one chord per bar, energy, lead behaviour and drum level. The on-device engine validates the plan (`parsePlan`: bad chords, instruments or timings are clamped or dropped) and performs it. If the AI is slow (9.5 s), offline, or the plan is invalid, the built-in rule-based composer plays instead, so music always starts. "Play another" asks for a fresh plan. Plans are stored with liked pieces so they replay exactly.

## Recorded instruments (v9)

Piano, acoustic and electric guitar, electric bass, sax, trumpet, trombone, flute and violin/strings now play **real recordings** (`public/samples/`, 3.5 MB total, mono mp3, MIT-licensed — see `samples/CREDITS.txt`). Each instrument's bank loads lazily the first time a piece uses it (and is then cached by the service worker); until it is decoded the synthesized voice plays, so playback never waits. Overdriven/distorted guitars run the clean electric-guitar recording through an amp-style waveshaper. Sustained instruments loop a matched section of the recording for long notes. Drums are recorded too: an acoustic kit (Pearl Master Studio by enoe, CC-BY 3.0) for rock, rock and roll, blues, jazz, reggae and funk, and a LinnDrum LM-2 kit for hip-hop; other styles keep the synthesized electronic kits, and percussion the recorded kits lack (shaker, rim, conga on the acoustic kit) stays synthesized. Keys/organ/hammond, marimba, pads, upright bass and synth basses are still synthesized.\nThe most-used banks (piano, electric guitar, bass, acoustic guitar, acoustic drums, about 2 MB) are pre-fetched quietly 9 seconds after the app opens, unless Data Saver is on or the connection is slow.
Controls: `EchoMusic.samples.enable(false)` falls back to pure synthesis; `.status()` shows bank state; `.preload()` warms everything.

## More recordings (v10)

Added recorded: electric piano ("keys"), Hammond-style drawbar organ, pipe organ, clavinet, marimba, a new **harp**, upright bass and a real string-ensemble section (FluidR3 GM, MIT), plus percussion (tambourine, cowbell, congas, clap, rim, shaker) on the acoustic and hip-hop kits, and recorded **Roland CR-78** (afrobeats/amapiano) and **TR-505** (house, pop) drum machines. House and pop keep their synthesized kick. Violin, sax, brass, flute and guitars are unchanged from v9. Everything is lazy-loaded with synth fallback; total sample folder is about 6 MB. Credits are in `public/samples/CREDITS.txt`.

## Kalimba, bells and choir (v11)

Kalimba, bells (a recorded glockenspiel) and choir now play recordings too (FluidR3 GM, ~0.6 MB). Still synthesized on purpose: pads, sub, 808 and synth basses, risers and effects. Total sample folder is about 7 MB, all lazy-loaded with synth fallback.

## Sample memory budget (v12)

Decoded audio is raw floats, so all 24 banks together would need about 180 MB. Banks now decode at their own low sample rate (32 kHz; about 25% smaller, ~133 MB for everything), and a memory budget keeps the total in check: 16 MB per GB of device memory when the browser reports it (32-128 MB), otherwise 72 MB. When a new bank needs room, banks idle for more than 30 s are dropped, oldest first; if nothing can be dropped, the bank waits (retrying every 15 s) and the synthesized voice keeps playing. `EchoMusic.samples.memory()` shows usage; `EchoMusic.samples.setBudgetMB(n)` overrides the budget.

## Reminders and check-ins: reliability fixes (v13)

- **Reminders can no longer be lost on the way to the server.** They go through an outbox (kept in the phone's storage) that retries until the server confirms, and deletes/moves keep their order.
- **Silent failures now speak up.** If notifications are off or blocked on a phone, the reminder confirmation says it can only fire while the app is open.
- **Self-healing push record.** On every app start (and every 30 min while open) the app re-saves this phone's subscription, recreating it if the browser dropped it or it was made for another server key.
- **Wider reminder phrasing** ("wake me at 6", "ping me at 4 to…", "reminder: …") is caught even when the model forgets its tag.
- **Reminders always show a real notification**, even if the app window is technically visible.
- **The reminder job now runs every minute** (was every 2), so reminders land within about a minute.
- **Check-ins:** older records without a saved choice get the default (every ~2 days); the daytime window is at least 7 hours; someone who opens the app often is no longer skipped forever.
- **Delivery log:** every send attempt is recorded in the `push_log` table (kept 7 days) so "why didn't I get it?" can be answered from the database.

## v14 — Composer agent: written melodies + critic loop
- The chat model still writes the plan (key, chords, form, band, hook). A second background pass now **writes the actual melody** (verse, chorus, bridge/solo) note by note, grounded in each bar's chord tones.
- `EchoMusic.critique(plan)` is a rule-based music critic (range, leaps, chord tones on the beat, phrase endings, repetition, verse/chorus contrast, form, energy). Score under 80 -> the model gets the critic's notes and rewrites once; the better version wins, below 45 the engine's own melody stays.
- The piece starts immediately; the written melody lands from the next section. `EchoMusic.setMelodies`, `EchoMusic.tonesOf` are the hooks. Repeated sections reuse their melody.
- `chat.js` accepts `maxTokens` (cap 3000) so melody replies are not truncated.

## v15 — Written bass lines
- A third background pass (parallel to the melody pass) has the model write the **bass line** for the first verse/chorus as chord-relative tones (`R, 3, 5, b7, 8, a` approach note), so one groove works over the whole progression and follows each chord change.
- The critic marks it separately (`critique(plan).bass`): root on beat 1, density, tone variety, syncopation, note lengths. Any issue triggers one rewrite from the critic's notes; the better version wins. `EchoMusic.setBass` applies it from the next section. `window.__lastBassScore` shows the accepted score.

## v16 — Written drum grooves + liked pieces teach the composer
- A fourth background pass writes a **drum groove** (16-step grid per voice: kick, snare, clap, hat, open, ride, rim, tamb, shaker, cow, tom, congas; `X` accent, `o` ghost) for the first verse and chorus, with an optional second-bar variation. `critique(plan).drums` checks backbeat, kick anchor, pulse, density, kick/snare collisions and genre rules (house four-on-the-floor, funk/afrobeats syncopation). One rewrite from the critic's notes; `EchoMusic.setDrums` applies it. Engine fills at phrase ends still play. `window.__lastDrumScore`.
- **Liked pieces teach the composer.** Saved pieces keep their full written plan (chords, melody, bass line, groove; a piece liked before its parts arrived is re-saved when they land). `EchoMusic.tasteProfile()` summarises styles, tempo range, major/minor lean, harmonic richness, favourite instruments; `EchoMusic.likedExamples(n, part)` returns compact examples. The plan, melody, bass and drum prompts all receive them with an instruction to write something new in the same spirit, never copy.
