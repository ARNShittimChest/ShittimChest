/**
 * Spine WebGL viewer for Arona L2D character.
 *
 * Replicates DesktopARONA Shell behaviors:
 * - Track 0: Idle_01 (loop)
 * - Track 1: Eye_Close_01 (periodic blink)
 * - Track 2: Lip shapes during chat (01/20/31/02)
 * - Track 3: Mouse follow (Dev_Look_01_M) / Head pat (Dev_Pat_01_M)
 * - Track 4: Emotion expression overlays per mood
 *
 * Reference: arona.java + submod.java from DesktopARONA/v1/Shell
 */

import type { Mood } from "../../../../src/companion/emotional-state.js";
export type { Mood };

// ── Types ────────────────────────────────────────────────────────────

export interface SpineViewer {
  dispose(): void;
  resize(w: number, h: number): void;
  setEmotion(mood: Mood): void;
  setChatActive(active: boolean): void;
}

// ── Animation Constants ──────────────────────────────────────────────

/** Lip shape animation names (cycle during active chat). */
const LIP_SHAPES = ["01", "20", "31", "02"] as const;

/** Frames of lip inactivity before clearing lip track. */
const LIP_IDLE_TIMEOUT_FRAMES = 12;

/** Emotion → track-4 animation mapping. */
const EMOTION_ANIMATIONS: Record<Mood, string | null> = {
  happy: "16",
  excited: "17",
  sad: "05",
  worried: "07",
  caring: "16",
  sleepy: "08",
  neutral: null, // clear track
};

/** Random blink interval range in frames (at 60fps ≈ 4-7s). */
const BLINK_MIN_FRAMES = 240;
const BLINK_MAX_FRAMES = 420;
const BLINK_CLOSE_FRAMES = 10;

/** Time scale for animation state (half speed, smoother feel). */
const TIME_SCALE = 0.5;

/** Skeleton scale factor matching DesktopARONA's 0.45f. */
const SKELETON_SCALE = 0.45;

// ── Sigmoid helper for pat animation (from arona.java lrgf) ──────────

function lrgf(x: number, slope: number, bias: number): number {
  return 0.667 * (0.23 + 0.52 / (1 + Math.exp(-slope * x - bias)));
}

// ── Viewer Implementation ────────────────────────────────────────────

export async function initSpineViewer(
  canvas: HTMLCanvasElement,
  basePath: string,
): Promise<SpineViewer> {
  // Dynamic import to avoid blocking initial load
  const spineWebgl = await import("@esotericsoftware/spine-webgl");
  const spineCore = await import("@esotericsoftware/spine-core");

  const glContext =
    canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true }) ??
    canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true });

  if (!glContext) {
    throw new Error("WebGL not supported");
  }
  const gl = glContext;

  // ── Load skeleton ──────────────────────────────────────────────────

  const assetManager = new spineWebgl.AssetManager(gl as WebGL2RenderingContext, basePath);
  assetManager.loadTextureAtlas("arona_spr.atlas");
  assetManager.loadBinary("arona_spr.skel");

  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (assetManager.isLoadingComplete()) {
        if (assetManager.hasErrors()) {
          reject(new Error(`Spine asset load error: ${JSON.stringify(assetManager.getErrors())}`));
        } else {
          resolve();
        }
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  });

  const atlas = assetManager.require("arona_spr.atlas") as spineCore.TextureAtlas;
  const atlasLoader = new spineCore.AtlasAttachmentLoader(atlas);
  const skelBinary = new spineCore.SkeletonBinary(atlasLoader);
  skelBinary.scale = SKELETON_SCALE;

  const skelData = skelBinary.readSkeletonData(
    assetManager.require("arona_spr.skel") as Uint8Array,
  );
  const skeleton = new spineCore.Skeleton(skelData);

  // ── Animation state ────────────────────────────────────────────────

  const stateData = new spineCore.AnimationStateData(skelData);

  // Set default mix for all animations
  stateData.defaultMix = 0.2;

  // Fast lip transitions
  for (const a of LIP_SHAPES) {
    for (const b of LIP_SHAPES) {
      if (a !== b) {
        stateData.setMix(a, b, 0.02);
        stateData.setMix(b, a, 0.02);
      }
    }
  }

  const state = new spineCore.AnimationState(stateData);
  state.timeScale = TIME_SCALE;
  state.setAnimation(0, "Idle_01", true);

  // ── Renderer ───────────────────────────────────────────────────────

  const renderer = new spineWebgl.SceneRenderer(canvas, gl as WebGL2RenderingContext);

  // ── Blink state ────────────────────────────────────────────────────

  let eyeCount = 0;
  let eyeClosed = false;
  let eyeLimit = randomBetween(BLINK_MIN_FRAMES, BLINK_MAX_FRAMES);

  // ── Lip sync state ─────────────────────────────────────────────────

  let chatActive = false;
  let lipIdleCount = 0;
  let currentLipIndex = 0;
  let currentLipAnim = "";

  // ── Mouse follow state ─────────────────────────────────────────────

  let mouseX = 0;
  let mouseY = 0;
  let mouseDown = false;
  let mouseInteraction: "none" | "look" | "pat" = "none";

  // Head center position (approximate, will be updated based on skeleton bounds)
  const headCenterX = canvas.width / 2;
  const headCenterY = canvas.height * 0.75;

  // ── Emotion state ──────────────────────────────────────────────────

  let emotionDurationRemaining = 0;

  // ── Event listeners ────────────────────────────────────────────────

  const onEmotionEvent = (e: Event) => {
    const mood = (e as CustomEvent<{ mood: Mood }>).detail.mood;
    setEmotion(mood);
  };
  document.addEventListener("spine:emotion", onEmotionEvent);

  const onMouseMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  };
  canvas.addEventListener("mousemove", onMouseMove);

  const onMouseDown = () => {
    mouseDown = true;
  };
  const onMouseUp = () => {
    if (mouseInteraction === "pat") {
      // Play pat end animation
      try {
        state.addAnimation(3, "Dev_PatEnd_01_M", false, 0);
      } catch {
        /* anim not found */
      }
      state.addEmptyAnimation(3, 0, 0);
    } else if (mouseInteraction === "look") {
      try {
        state.addAnimation(3, "Dev_LookEnd_01_M", false, 0);
      } catch {
        /* anim not found */
      }
      state.addEmptyAnimation(3, 0, 0);
    }
    mouseDown = false;
    mouseInteraction = "none";
    eyeCount = 0;
  };
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("mouseleave", onMouseUp);

  // ── Render loop ────────────────────────────────────────────────────

  let disposed = false;
  let lastTime = performance.now();

  function frame(now: number) {
    if (disposed) {
      return;
    }

    const dt = Math.min((now - lastTime) / 1000, 0.1); // cap delta
    lastTime = now;

    // ── Blink logic ────────────────────────────────────────────────
    if (mouseInteraction === "none") {
      eyeCount++;
      if (eyeCount >= eyeLimit) {
        if (!eyeClosed) {
          try {
            state.setAnimation(1, "Eye_Close_01", false);
          } catch {
            /* */
          }
          eyeCount = 0;
          eyeLimit = BLINK_CLOSE_FRAMES;
          eyeClosed = true;
        } else {
          state.setEmptyAnimation(1, 0.5);
          eyeCount = 0;
          eyeLimit = randomBetween(BLINK_MIN_FRAMES, BLINK_MAX_FRAMES);
          eyeClosed = false;
        }
      }
    }

    // ── Lip sync logic ─────────────────────────────────────────────
    if (chatActive) {
      // Cycle through lip shapes
      lipIdleCount = 0;
      const nextLip = LIP_SHAPES[currentLipIndex % LIP_SHAPES.length];
      if (nextLip !== currentLipAnim) {
        try {
          state.setAnimation(2, nextLip, false);
        } catch {
          /* */
        }
        currentLipAnim = nextLip;
      }
      // Advance lip shape every few frames
      if (eyeCount % 4 === 0) {
        currentLipIndex++;
      }
    } else if (currentLipAnim) {
      lipIdleCount++;
      if (lipIdleCount >= LIP_IDLE_TIMEOUT_FRAMES) {
        try {
          state.setAnimation(2, "01", false);
          state.setEmptyAnimation(2, 0.03);
        } catch {
          /* */
        }
        currentLipAnim = "";
        lipIdleCount = 0;
      }
    }

    // ── Mouse follow / pat logic ───────────────────────────────────
    if (mouseDown && mouseInteraction !== "pat") {
      const relX = mouseX - headCenterX;
      const relY = mouseY - headCenterY;
      const dist = Math.sqrt(relX * relX + relY * relY);

      // Head zone: close click = pat
      if (dist < 30 && mouseInteraction !== "look") {
        mouseInteraction = "pat";
        try {
          const patTime = lrgf(relX, 0.5, 0.0);
          const entry = state.setAnimation(3, "Dev_Pat_01_M", false);
          entry.animationStart = patTime;
        } catch {
          /* */
        }
      } else if (dist < 150) {
        // Face zone: follow
        mouseInteraction = "look";
        try {
          const degree = Math.atan2(relY, relX) * (180 / Math.PI) + 180;
          const offset = 3.33 * 0.24;
          const actualDur = 3.33 * 0.61;
          const meta = degree * (actualDur / 360) + offset;
          const lookAnim = skelData.findAnimation("Dev_Look_01_M");
          if (lookAnim) {
            lookAnim.apply(
              skeleton,
              -1,
              meta,
              false,
              [],
              1,
              spineCore.MixBlend.first,
              spineCore.MixDirection.mixIn,
            );
          }
        } catch {
          /* */
        }
      }
    }

    // ── Emotion duration countdown ─────────────────────────────────
    if (emotionDurationRemaining > 0) {
      emotionDurationRemaining--;
      if (emotionDurationRemaining <= 0) {
        state.setEmptyAnimation(4, 0.5);
      }
    }

    // ── Update & render ────────────────────────────────────────────
    state.update(dt);
    state.apply(skeleton);
    skeleton.updateWorldTransform();

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    renderer.camera.position.x = canvas.width / 2;
    renderer.camera.position.y = canvas.height / 2;
    renderer.camera.viewportWidth = canvas.width;
    renderer.camera.viewportHeight = canvas.height;

    renderer.begin();
    renderer.drawSkeleton(skeleton, true);
    renderer.end();

    requestAnimationFrame(frame);
  }

  // Position skeleton
  skeleton.x = canvas.width / 2;
  skeleton.y = 50; // near bottom

  requestAnimationFrame(frame);

  // ── Public API ─────────────────────────────────────────────────────

  function setEmotion(mood: Mood) {
    const anim = EMOTION_ANIMATIONS[mood];
    if (anim === null) {
      // neutral → clear emotion track
      state.setEmptyAnimation(4, 0.5);
      emotionDurationRemaining = 0;
    } else {
      try {
        state.setAnimation(4, anim, false);
        emotionDurationRemaining = randomBetween(120, 180);
      } catch {
        // Animation not found in skeleton, silently ignore
      }
    }
  }

  return {
    dispose() {
      disposed = true;
      document.removeEventListener("spine:emotion", onEmotionEvent);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mouseleave", onMouseUp);
      renderer.dispose();
    },

    resize(w: number, h: number) {
      canvas.width = w;
      canvas.height = h;
      skeleton.x = w / 2;
      skeleton.y = 50;
    },

    setEmotion,

    setChatActive(active: boolean) {
      chatActive = active;
      if (!active) {
        currentLipIndex = 0;
      }
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
