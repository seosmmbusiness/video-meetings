# Transcription fixtures

Two of phase 1's cases need a recording of real speech, and no test can make one: AC-4 asserts the
words a recording is known to carry, and AC-13 asserts that a non-English recording comes back in
the language spoken. Both recordings are **provisioned on the machine** and are not committed —
they are binary media, and the words expected of them belong beside them rather than in a spec.

Everything else phase 1 needs is built in code: the crafted container AC-19 uses is assembled byte
by byte in `transcription-fixtures.ts`.

## What to provision

| File                           | What it must be                                                     |
| ------------------------------ | ------------------------------------------------------------------- |
| `english-speech.wav`           | English speech, WAV, a few seconds, clearly articulated             |
| `english-speech.wav.words.txt` | The words that recording is known to carry, one per line, lowercase |
| `russian-speech.wav`           | Russian speech, WAV, a few seconds, clearly articulated             |
| `russian-speech.wav.words.txt` | The words that recording is known to carry, one per line, lowercase |

A word list is one word per line; blank lines are ignored. Keep the list to words a `tiny` model
transcribes unambiguously — the point of the case is that the engine really ran, not that it is
flawless. Do not list a word that also appears in the file's own name: AC-4's case requires that the
file name is not what the assertion could pass on.

The recommended English recording is whisper.cpp's own `samples/jfk.wav` (public domain, ~11 s,
"And so, my fellow Americans, ask not what your country can do for you, ask what you can do for
your country"), whose word list is then `fellow`, `americans`, `country`. For Russian, any short
public-domain or self-recorded clip does; write down the words you can hear in it.

Both files stay out of git — the `.gitignore` beside this README keeps them there.
