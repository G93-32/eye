# Eye

An eye made of text characters. It watches your pointer, blinks, and has another eye inside its pupil.

**Live:** https://g93-32.github.io/eye/

No images and no libraries. It is one HTML file, one stylesheet and one script that runs a single WebGL fragment shader.

## How it works

- **Characters.** The screen is cut into a grid of character cells. For each cell the shader works out how bright the eye is at the centre of that cell, then picks a glyph of matching weight from a strip of 69 characters, running from `.` to `$`. The strip is drawn once into a texture with the Canvas 2D API, so the shader only has to look glyphs up.
- **The eye.** Lids, lashes, sclera, iris fibres and the catch-light are all maths inside the shader: two curves for the lids, noise sampled by direction for the iris, a soft falloff for the skin around it. Faint areas are left mostly empty instead of being filled with dots, which gives the scattered edges.
- **Falling in.** The pupil is a window onto a copy of the same eye, 12.5 times smaller. The camera zooms toward the pupil along a path that ends exactly where it started, one eye down, so the dive can repeat for ever in either direction.
- **Life.** Each eye blinks on its own clock, the gaze follows the pointer with a quick snap like a real saccade, and the glyphs reshuffle a few times a second.

## Controls

- Move the pointer (or drag on a phone) and it looks at you.
- Click or tap to fall into the pupil. Shift-click or right-click to climb back out.
- Scroll to drift in or out freely. Arrow keys, Space and Enter work too.
- Leave it alone and it looks around by itself and dives every few seconds.

## Run it locally

Serve the folder and open it:

```bash
python -m http.server 8323
```

Inspired by an ASCII eye reel by emaaad.d. This version is written from scratch in JavaScript and GLSL.
