import * as THREE from 'three';
import { net, netAvailable, connectRoom, claimSlot, leaveRoom, updateMeta, onPlayers, sendMe, sendWorld, sendWorldForce } from './net.js';

// ============================================================
// Flopfish FC — a beached-fish football game 🐟⚽
// Core idea: the fish can't walk. It FLOPS. Movement is a
// physics impulse from wriggling, deliberately hard to aim.
// ============================================================

// ---------- Tunables (tweak the feel here) ----------
const CONFIG = {
  field:      { halfX: 22, halfZ: 14 },      // playing area half-extents
  goal:       { width: 7, height: 3.2, depth: 1.4 },
  flop:       {
    forward:  7.2,   // forward impulse per flop
    up:       6.0,   // vertical hop
    sideRand: 2.2,   // random sideways scatter (the "uncontrollable" charm)
    cooldown: 0.32,  // seconds between flops
    chargeMax: 0.45, // hold-to-charge window (adds power)
    chargeBoost: 0.9,// extra forward multiplier at full charge
  },
  turnSpeed:  2.6,   // radians/sec while pressing A/D
  gravity:    18,
  groundBounce: 0.34,
  groundFriction: 0.86,
  ball:       {
    radius: 0.55, gravity: 20, bounce: 0.55, friction: 0.985, airDrag: 0.995,
  },
  matchSeconds: 120,
};

// ---------- Renderer / scene / camera ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 120);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 12, 20);

// ---------- Lights ----------
const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3a7d2c, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(20, 34, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 120;
sun.shadow.bias = -0.0004;
scene.add(sun);

// ============================================================
// Field
// ============================================================
function buildField() {
  const group = new THREE.Group();
  const { halfX, halfZ } = CONFIG.field;

  // Striped grass
  const stripes = 10;
  for (let i = 0; i < stripes; i++) {
    const w = (halfX * 2) / stripes;
    const geo = new THREE.PlaneGeometry(w, halfZ * 2);
    const shade = i % 2 === 0 ? 0x3fa34d : 0x379445;
    const mat = new THREE.MeshStandardMaterial({ color: shade, roughness: 1 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(-halfX + w * (i + 0.5), 0, 0);
    m.receiveShadow = true;
    group.add(m);
  }

  // Surrounding grass margin (darker)
  const margin = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x2c7a3d, roughness: 1 })
  );
  margin.rotation.x = -Math.PI / 2;
  margin.position.y = -0.02;
  margin.receiveShadow = true;
  group.add(margin);

  // White lines
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const addLine = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    group.add(m);
  };
  const t = 0.18;
  addLine(halfX * 2, t, 0, -halfZ);       // top boundary
  addLine(halfX * 2, t, 0, halfZ);        // bottom boundary
  addLine(t, halfZ * 2, -halfX, 0);       // left boundary
  addLine(t, halfZ * 2, halfX, 0);        // right boundary
  addLine(t, halfZ * 2, 0, 0);            // halfway line

  // Center circle
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 3.6, 48),
    lineMat
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);

  scene.add(group);
}
buildField();

// ============================================================
// Goals (two of them, at ±halfX). Returns their world bounds.
// ============================================================
const goals = [];
function buildGoals() {
  const { halfX } = CONFIG.field;
  const { width, height, depth } = CONFIG.goal;
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.1 });
  const netMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, roughness: 1,
  });

  [-1, 1].forEach((side) => {
    const g = new THREE.Group();
    const x = side * (halfX + 0.1);
    const postR = 0.14;
    const half = width / 2;

    const post = (px, pz, h) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, h, 12), postMat);
      m.position.set(px, h / 2, pz);
      m.castShadow = true;
      g.add(m);
    };
    // Two uprights + crossbar
    post(x, -half, height);
    post(x, half, height);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, width, 12), postMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(x, height, 0);
    bar.castShadow = true;
    g.add(bar);

    // Net (back + roof + sides) pushed outward by `depth`
    const back = new THREE.Mesh(new THREE.PlaneGeometry(width, height), netMat);
    back.position.set(x + side * depth, height / 2, 0);
    back.rotation.y = Math.PI / 2;
    g.add(back);

    scene.add(g);

    // Scoring volume: ball crossing the goal line within the mouth
    goals.push({
      side,
      lineX: x,
      minZ: -half + 0.2,
      maxZ: half - 0.2,
      maxY: height - 0.2,
      outerX: x + side * (depth + 0.6),
    });
  });
}
buildGoals();

// ============================================================
// Placeholder fish — sculpted from primitives.
// Swap for a real model in loadFish() below.
// The whole fish lives in `fish.root`; body parts wobble for the flop.
// ============================================================
function makePlaceholderFish() {
  const root = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xff8c42, roughness: 0.5, metalness: 0.1 });
  const belly = new THREE.MeshStandardMaterial({ color: 0xffd9a0, roughness: 0.6 });
  const finMat = new THREE.MeshStandardMaterial({
    color: 0xff6b35, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
  });

  // Body — a stretched, flattened sphere
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), skin);
  body.scale.set(1.7, 0.85, 0.95);
  body.castShadow = true;
  root.add(body);

  const bellyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.98, 24, 18), belly);
  bellyMesh.scale.set(1.68, 0.5, 0.9);
  bellyMesh.position.y = -0.32;
  root.add(bellyMesh);

  // Tail — a pivoting group so it can swish
  const tail = new THREE.Group();
  tail.position.set(-1.6, 0, 0);
  const tailFin = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.1, 4), finMat);
  tailFin.rotation.z = Math.PI / 2;
  tailFin.rotation.x = Math.PI / 4;
  tailFin.position.x = -0.5;
  tailFin.scale.set(1, 1, 0.25);
  tailFin.castShadow = true;
  tail.add(tailFin);
  root.add(tail);

  // Side (pectoral) fins
  const mkFin = (side) => {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4), finMat);
    f.rotation.x = Math.PI / 2;
    f.rotation.z = side * -0.4;
    f.position.set(0.2, -0.1, side * 0.8);
    f.scale.set(1, 1, 0.3);
    return f;
  };
  const finL = mkFin(1), finR = mkFin(-1);
  root.add(finL, finR);

  // Dorsal fin
  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.0, 4), finMat);
  dorsal.position.set(0.1, 0.85, 0);
  dorsal.scale.set(1.4, 1, 0.2);
  root.add(dorsal);

  // Eyes
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const eyeBlack = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const mkEye = (side) => {
    const g = new THREE.Group();
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), eyeWhite);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), eyeBlack);
    b.position.set(0.18, 0, side * 0.08);
    g.add(w, b);
    g.position.set(1.05, 0.35, side * 0.42);
    return g;
  };
  root.add(mkEye(1), mkEye(-1));

  return { root, parts: { body, tail, finL, finR, dorsal } };
}

// ---------- Fish roster (skins) ----------
// Each entry is a selectable fish. `length` = desired body length (world units).
const FISH_ROSTER = [
  { id: 'koi',    name: 'ปลาคาร์ป',    emoji: '🎏', file: 'fish.glb',   length: 3.4 },
  // fix = extra roll/pitch when the auto side-lay guesses wrong (minor
  // axes too close, or the model authored standing vertically).
  { id: 'minnow', name: 'ปลาซิว',      emoji: '🐠', file: 'minnow.glb', length: 3.8 },
  { id: 'guppy',  name: 'ปลาหางนกยูง', emoji: '🦚', file: 'guppy.glb',  length: 3.2 },
  { id: 'bass',   name: 'ปลากะพง',     emoji: '🐡', file: 'bass.glb',   length: 3.6, fix: { x: Math.PI / 2, z: -Math.PI / 2 } },
];

// Build the rotation that lays ANY fish on its side like a beached fish:
// its longest axis → horizontal X (body length), thinnest axis → up (Y)
// so a flank faces the sky, middle axis → Z. Handedness is corrected so
// the model isn't mirrored inside-out.
function sideLayQuaternion(size) {
  const dims = [['x', size.x], ['y', size.y], ['z', size.z]].sort((a, b) => b[1] - a[1]);
  const longAx = dims[0][0], medAx = dims[1][0], thinAx = dims[2][0];
  const img = {};
  img[longAx] = new THREE.Vector3(1, 0, 0);
  img[thinAx] = new THREE.Vector3(0, 1, 0);
  img[medAx]  = new THREE.Vector3(0, 0, 1);
  const basis = new THREE.Matrix4().makeBasis(img.x, img.y, img.z);
  if (basis.determinant() < 0) { img.y.negate(); basis.makeBasis(img.x, img.y, img.z); }
  return {
    quat: new THREE.Quaternion().setFromRotationMatrix(basis),
    longLen: dims[0][1], medLen: dims[1][1], thinLen: dims[2][1],
  };
}

// Generic loader: normalizes size, lays the fish on its side, wires up any
// built-in swim animation. Hierarchy is wrapper → flopGroup → pose → model,
// where the game drives wrapper (position + heading) and flopGroup (thrash).
async function loadFishModel(cfg) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync('./assets/' + cfg.file);
  const model = gltf.scene;
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

  // Measure from base-mesh vertices (robust to morph-target / stray-node
  // bounding-box inflation seen in these Sketchfab exports).
  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes.position) {
      const p = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(p.count / 4000));
      for (let i = 0; i < p.count; i += step) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld);
        box.expandByPoint(v);
      }
    }
  });
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);

  const lay = sideLayQuaternion(size);
  const scale = cfg.length / (lay.longLen || 1);
  model.position.set(-center.x, -center.y, -center.z); // center at origin

  // Per-fish orientation correction, applied in the laid (world) frame:
  // fix.x = roll around body length (flip belly up/down), fix.z = pitch
  // (fix a nose-dive), fix.y = yaw (swap head/tail).
  const q = lay.quat.clone();
  if (cfg.fix) {
    const c = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(cfg.fix.x || 0, cfg.fix.y || 0, cfg.fix.z || 0));
    q.premultiply(c);
  }

  const pose = new THREE.Group();
  pose.quaternion.copy(q);
  pose.scale.setScalar(scale);
  pose.add(model);

  const flopGroup = new THREE.Group();
  flopGroup.add(pose);
  const wrapper = new THREE.Group();
  wrapper.add(flopGroup);

  // Lying on its side, the fish's height off the ground is its (thin) width.
  const restY = (lay.thinLen * scale) / 2 + 0.04;

  let mixer = null;
  if (gltf.animations && gltf.animations.length) {
    mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(gltf.animations[0]).play();
  }
  return { wrapper, flopGroup, mixer, restY };
}

// Cache + swap logic so switching skins is instant after first load.
const fishCache = {};
let selectedFishId = FISH_ROSTER[0].id;

// Load a fresh model instance for a player (each fish on the field needs
// its own object, so we don't share/clone — we load per player).
async function loadFishInstance(id) {
  const cfg = FISH_ROSTER.find((f) => f.id === id) || FISH_ROSTER[0];
  try {
    return await loadFishModel(cfg);
  } catch (e) {
    console.error('Fish "' + id + '" failed to load — using placeholder.', e);
    const ph = makePlaceholderFish();
    const flopGroup = new THREE.Group(); flopGroup.add(ph.root);
    const wrapper = new THREE.Group(); wrapper.add(flopGroup);
    return { wrapper, flopGroup, mixer: null, restY: 0.85 };
  }
}

// Attach (or replace) a player's 3D model + name label.
async function attachModel(p, id) {
  const inst = await loadFishInstance(id);
  if (p.root && p.root !== inst.wrapper) scene.remove(p.root);
  p.skin = id;
  p.root = inst.wrapper;
  p.flopGroup = inst.flopGroup;
  p.mixer = inst.mixer;
  p.restY = inst.restY;
  if (p.pos.y < p.restY) p.pos.y = p.restY;
  inst.wrapper.visible = true;
  scene.add(inst.wrapper);
  updatePlayerLabel(p);
}

// Skin picker → change the local player's skin (live preview in menu).
async function setFish(id) {
  selectedFishId = id;
  if (localPlayer) await attachModel(localPlayer, id);
}

// ============================================================
// Human opponent (Ronaldo) — rigged avatar, no baked animation.
// Loaded, normalized to a target height, and faced along the field.
// ============================================================
const HUMAN_MODEL = {
  targetHeight: 3.4,   // world units tall (towers over the flopping fish)
  yawOffset: 0,        // extra Y rotation so the front faces +X (tuned after first view)
};

async function loadHuman() {
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync('./assets/ronaldo.glb');
    const model = gltf.scene;
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

    // Measure base pose from vertices (skinned bind pose ≈ standing T-pose)
    model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    model.traverse((o) => {
      if (o.isMesh && o.geometry?.attributes.position) {
        const p = o.geometry.attributes.position;
        const step = Math.max(1, Math.floor(p.count / 800));
        for (let i = 0; i < p.count; i += step) {
          v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld);
          box.expandByPoint(v);
        }
      }
    });
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const scale = HUMAN_MODEL.targetHeight / (size.y || 1);
    model.scale.setScalar(scale);
    // Feet on the ground, centered horizontally
    model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

    const wrapper = new THREE.Group();
    const spin = new THREE.Group();
    spin.rotation.y = HUMAN_MODEL.yawOffset;
    spin.add(model);
    wrapper.add(spin);

    // Grab the skeleton bones we animate procedurally (Mixamo naming).
    const boneNames = {
      leftArm: 'LeftArm_013', rightArm: 'RightArm_039',
      leftForeArm: 'LeftForeArm_014', rightForeArm: 'RightForeArm_040',
      leftUpLeg: 'LeftUpLeg_063', rightUpLeg: 'RightUpLeg_068',
      leftLeg: 'LeftLeg_064', rightLeg: 'RightLeg_069',
    };
    const bones = {};
    model.traverse((o) => {
      if (o.isBone) {
        for (const k in boneNames) if (o.name === boneNames[k]) bones[k] = o;
      }
    });
    // Break out of the T-pose: rotate the upper arms down to the sides
    // (+X in bone-local space lowers the arm), with a slight elbow bend.
    if (bones.leftArm) bones.leftArm.rotation.x += 1.3;
    if (bones.rightArm) bones.rightArm.rotation.x += 1.3;
    if (bones.leftForeArm) bones.leftForeArm.rotation.x += 0.2;
    if (bones.rightForeArm) bones.rightForeArm.rotation.x += 0.2;
    // Remember this rest pose so walk/kick animation adds on top of it.
    const rest = {};
    for (const k in bones) rest[k] = bones[k].rotation.clone();

    return { root: wrapper, ok: true, bones, rest };
  } catch (e) {
    console.error('Ronaldo model failed to load.', e);
    // Fallback: a simple capsule so the opponent still exists
    const wrapper = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.6, 2.2, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0x2244cc })
    );
    body.position.y = 1.7; body.castShadow = true;
    wrapper.add(body);
    return { root: wrapper, ok: false };
  }
}

// ============================================================
// Ball
// ============================================================
const ball = {
  mesh: null,
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
};
function buildBall() {
  const geo = new THREE.SphereGeometry(CONFIG.ball.radius, 24, 18);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  ball.mesh = new THREE.Mesh(geo, mat);
  ball.mesh.castShadow = true;
  scene.add(ball.mesh);

  // Pentagon-ish spots so rolling is visible
  const spotMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Mesh(new THREE.CircleGeometry(0.16, 5), spotMat);
    const phi = Math.acos(1 - 2 * (i + 0.5) / 8);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    s.position.setFromSphericalCoords(CONFIG.ball.radius + 0.001, phi, theta);
    s.lookAt(s.position.clone().multiplyScalar(2));
    ball.mesh.add(s);
  }
}
buildBall();

// ============================================================
// Teams & players (multiplayer-ready: up to 6 versus / 3 co-op).
// Left side = red, right side = blue. Co-op uses one green fish team.
// ============================================================
const TEAMS = {
  red:  { label: 'แดง',    color: 0xff4a5c, css: '#ff4a5c', homeX: -8, attackSide: +1 },
  blue: { label: 'น้ำเงิน', color: 0x4a90ff, css: '#4a90ff', homeX: +8, attackSide: -1 },
  fish: { label: 'ทีมปลา', color: 0x39d353, css: '#39d353', homeX: -8, attackSide: +1 },
};
// Slots per mode (how many fish are on the field)
const MODE_SLOTS = { versus: 6, coop: 3 };

let players = [];
let localPlayer = null;

function makePlayer(opts) {
  return {
    id: opts.id,
    name: opts.name || 'ปลา',
    team: opts.team,           // 'red' | 'blue' | 'fish'
    isLocal: !!opts.isLocal,
    isBot: !!opts.isBot,
    isRemote: !!opts.isRemote, // ผู้เล่นจริงคนอื่น (ขยับตามข้อมูลเน็ต)
    skin: opts.skin || selectedFishId,
    root: null, flopGroup: null, mixer: null, restY: 0.6,
    pos: new THREE.Vector3(0, 0.6, 0),
    vel: new THREE.Vector3(),
    heading: opts.heading != null ? opts.heading : Math.PI / 2,
    // เป้าหมายจากเน็ต (สำหรับ isRemote/บอทฝั่ง client) ไว้ค่อย ๆ ลerp เข้าหา
    netPos: new THREE.Vector3(0, 0.6, 0),
    netHeading: opts.heading != null ? opts.heading : Math.PI / 2,
    flopSeq: 0, lastFlopSeq: 0,
    flopTimer: 0, wobble: 0, charge: 0, charging: false,
    botTimer: Math.random() * 0.5,
    breathTimer: Math.random() * 4,  // staggered so fish don't breathe in unison
    phase: Math.random() * 10,      // desync flop animation between fish
    label: null, labelTex: null, labelCanvas: null,
  };
}

// ---------- Name + team-color label above each fish ----------
function makePlayerLabel(p) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 72;
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(3.4, 0.96, 1);
  spr.renderOrder = 999;
  p.label = spr; p.labelTex = tex; p.labelCanvas = canvas;
  scene.add(spr);
  drawPlayerLabel(p);
}
function drawPlayerLabel(p) {
  const canvas = p.labelCanvas; if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const col = TEAMS[p.team] ? TEAMS[p.team].css : '#888';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // rounded pill in team color
  const w = canvas.width, h = canvas.height, r = 24, pad = 6;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(pad + r, pad);
  ctx.arcTo(w - pad, pad, w - pad, h - pad, r);
  ctx.arcTo(w - pad, h - pad, pad, h - pad, r);
  ctx.arcTo(pad, h - pad, pad, pad, r);
  ctx.arcTo(pad, pad, w - pad, pad, r);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 4; ctx.stroke();
  // text
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const txt = (p.isLocal ? '★ ' : '') + p.name;
  ctx.fillText(txt.length > 12 ? txt.slice(0, 12) : txt, w / 2, h / 2 + 2);
  p.labelTex.needsUpdate = true;
}
function updatePlayerLabel(p) {
  if (!p.label) makePlayerLabel(p); else drawPlayerLabel(p);
}

// ============================================================
// Ronaldo (AI opponent). Present only in co-op mode. Unlike the fish,
// he can walk freely — that's the threat. He shepherds the ball toward
// the LEFT goal (his target) while the fish attacks the RIGHT goal.
// ============================================================
const ronaldo = {
  root: null,
  active: false,
  pos: new THREE.Vector3(8, 0, 0),
  heading: 0,
  kickTimer: 0,
  vel: new THREE.Vector3(),
  bones: null,       // skeleton bones we animate
  rest: null,        // their rest-pose rotations (arms down)
  walkPhase: 0,      // advances with distance walked
  moving: 0,         // 0..1 how much he's walking this frame
  kickAnim: 0,       // 1 → 0 decay for the kick pose
};
const RON = {
  speed: 6.5,        // walk speed (units/s)
  kickRange: 2.4,    // distance to ball to kick
  kickPower: 14,     // how hard he boots it
  kickCooldown: 0.5,
  targetGoalX: -CONFIG.field.halfX, // he shoots toward the LEFT goal
};

function stepRonaldo(dt) {
  if (!ronaldo.active) return;
  if (ronaldo.kickTimer > 0) ronaldo.kickTimer -= dt;

  const dx = ball.pos.x - ronaldo.pos.x;
  const dz = ball.pos.z - ronaldo.pos.z;
  const distToBall = Math.hypot(dx, dz);

  // Aim to get on the +X side of the ball so a kick pushes it toward -X.
  const approach = new THREE.Vector3(ball.pos.x + 2.2, 0, ball.pos.z);
  const ax = approach.x - ronaldo.pos.x;
  const az = approach.z - ronaldo.pos.z;
  const aDist = Math.hypot(ax, az) || 1;
  const move = Math.min(RON.speed * dt, aDist);
  ronaldo.pos.x += (ax / aDist) * move;
  ronaldo.pos.z += (az / aDist) * move;

  // Drive walk animation from distance covered
  ronaldo.moving = Math.min(1, move / (RON.speed * dt + 1e-6));
  ronaldo.walkPhase += move * 3.2;
  if (ronaldo.kickAnim > 0) ronaldo.kickAnim = Math.max(0, ronaldo.kickAnim - dt * 3.5);

  // Face the ball
  const targetAngle = Math.atan2(dx, dz);
  let da = ((targetAngle - ronaldo.heading + Math.PI) % (Math.PI * 2)) - Math.PI;
  ronaldo.heading += da * Math.min(1, dt * 6);

  // Keep him on the pitch
  const bx = CONFIG.field.halfX + 0.5, bz = CONFIG.field.halfZ + 0.5;
  ronaldo.pos.x = Math.max(-bx, Math.min(bx, ronaldo.pos.x));
  ronaldo.pos.z = Math.max(-bz, Math.min(bz, ronaldo.pos.z));

  // Kick toward his goal (left, z→0)
  if (distToBall < RON.kickRange && ronaldo.kickTimer <= 0 && ball.pos.x < ronaldo.pos.x + 0.5) {
    const toGoal = new THREE.Vector3(RON.targetGoalX - ball.pos.x, 0, -ball.pos.z * 0.6);
    toGoal.normalize();
    ball.vel.x += toGoal.x * RON.kickPower;
    ball.vel.z += toGoal.z * RON.kickPower;
    ball.vel.y += 2.5;
    ronaldo.kickTimer = RON.kickCooldown;
    ronaldo.kickAnim = 1;   // trigger the kick pose
    playFlopSound(1.4);
  }
}

function animateHuman(t) {
  if (!ronaldo.root) return;
  ronaldo.root.visible = ronaldo.active;
  if (!ronaldo.active) return;
  ronaldo.root.position.copy(ronaldo.pos);
  ronaldo.root.rotation.y = ronaldo.heading;

  const b = ronaldo.bones, rest = ronaldo.rest;
  if (b && rest) {
    const sw = ronaldo.moving;                  // 0..1 walking amount
    const s = Math.sin(ronaldo.walkPhase);
    const c = Math.sin(ronaldo.walkPhase + Math.PI);
    const legAmp = 0.7 * sw, armAmp = 0.45 * sw;

    // Legs swing opposite each other; knees bend on the backswing
    if (b.leftUpLeg)  b.leftUpLeg.rotation.x  = rest.leftUpLeg.x  + s * legAmp;
    if (b.rightUpLeg) b.rightUpLeg.rotation.x = rest.rightUpLeg.x + c * legAmp;
    if (b.leftLeg)  b.leftLeg.rotation.x  = rest.leftLeg.x  + Math.max(0, s) * 0.7 * sw;
    if (b.rightLeg) b.rightLeg.rotation.x = rest.rightLeg.x + Math.max(0, c) * 0.7 * sw;

    // Arms counter-swing to the legs
    if (b.leftArm)  b.leftArm.rotation.x  = rest.leftArm.x  + c * armAmp;
    if (b.rightArm) b.rightArm.rotation.x = rest.rightArm.x + s * armAmp;

    // Kick: snap the right leg forward (overrides the walk swing)
    if (ronaldo.kickAnim > 0) {
      const k = ronaldo.kickAnim;
      if (b.rightUpLeg) b.rightUpLeg.rotation.x = rest.rightUpLeg.x - k * 1.3;
      if (b.rightLeg)   b.rightLeg.rotation.x   = rest.rightLeg.x + k * 0.2;
    }
  }

  // Subtle vertical bob while walking
  ronaldo.root.position.y = Math.abs(Math.sin(ronaldo.walkPhase)) * 0.06 * ronaldo.moving;
}

// ============================================================
// Input
// ============================================================
const keys = new Set();
window.addEventListener('keydown', (e) => {
  // Don't hijack keys while the player is typing in a text field.
  if (e.target && e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (k === ' ' && !keys.has(' ') && localPlayer) localPlayer.charging = true;
  if (k === 'r' && state.playing) restartMatch();
  if (k === 'escape') goToMenu();
  if (k === 'f') toggleFullscreen();
  keys.add(k);
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === ' ' && localPlayer) { doFlop(localPlayer); localPlayer.charging = false; }
  keys.delete(k);
});
// Pointer = quick flop (mobile / lazy)
renderer.domElement.addEventListener('pointerdown', () => { if (localPlayer) localPlayer.charging = true; });
renderer.domElement.addEventListener('pointerup', () => { if (localPlayer) { doFlop(localPlayer); localPlayer.charging = false; } });

// A flop: impulse forward from the fish's heading, with random scatter.
function doFlop(p) {
  if (!p || p.flopTimer > 0 || !state.playing) { if (p) p.charge = 0; return; }
  const C = CONFIG.flop;
  const chargeAmt = Math.min(p.charge / C.chargeMax, 1);
  const power = 1 + chargeAmt * C.chargeBoost;

  const fwd = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
  const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const scatter = (Math.random() - 0.5) * C.sideRand;

  p.vel.addScaledVector(fwd, C.forward * power);
  p.vel.y += C.up * (0.8 + 0.4 * chargeAmt);
  p.vel.addScaledVector(side, scatter);
  p.heading += (Math.random() - 0.5) * 0.25;

  p.flopTimer = C.cooldown;
  p.wobble = 1;
  p.charge = 0;
  p.flopSeq = (p.flopSeq || 0) + 1;      // นับจำนวนดีด ให้เครื่องอื่นรู้ว่าดีดแล้ว
  if (p.isLocal) playFlopSound(power);   // only the local flop makes noise
}

// ============================================================
// Tiny WebAudio "flop" — no asset files needed
// ============================================================
let audioCtx = null;
let masterGain = null;
// All sounds route through masterGain so the settings slider controls volume.
function audioOut() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (!masterGain) {
    masterGain = audioCtx.createGain();
    masterGain.gain.value = settings.volume;
    masterGain.connect(audioCtx.destination);
  }
  return masterGain;
}
function setVolume(v) {
  settings.volume = Math.max(0, Math.min(1, v));
  if (masterGain) masterGain.gain.value = settings.volume;
}
function playFlopSound(power = 1) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140 * power, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.14);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(audioOut());
    osc.start(t); osc.stop(t + 0.2);
  } catch (e) { /* audio optional */ }
}
function playGoalSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.08);
      g.gain.exponentialRampToValueAtTime(0.2, t + i * 0.08 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.25);
      o.connect(g).connect(audioOut());
      o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.3);
    });
  } catch (e) {}
}

// ---------- Fish breathing sounds (9 random clips) ----------
const breathBuffers = [];   // decoded AudioBuffers
async function loadBreathSounds() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await Promise.all(Array.from({ length: 9 }, async (_, i) => {
      try {
        const res = await fetch(`./assets/sounds/breath${i + 1}.mp3`);
        const arr = await res.arrayBuffer();
        breathBuffers[i] = await audioCtx.decodeAudioData(arr);
      } catch (e) { /* skip a missing/bad clip */ }
    }));
  } catch (e) { /* audio optional */ }
}
// Play one random breath clip, panned by the fish's field position.
function playBreath(p) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const ready = breathBuffers.filter(Boolean);
  if (!ready.length) return;
  const buf = ready[Math.floor(Math.random() * ready.length)];
  const src = audioCtx.createBufferSource(); src.buffer = buf;
  const gain = audioCtx.createGain();
  gain.gain.value = p.isLocal ? 0.55 : 0.4;
  let node = src;
  if (audioCtx.createStereoPanner) {
    const pan = audioCtx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, p.pos.x / CONFIG.field.halfX));
    src.connect(pan); node = pan;
  }
  node.connect(gain).connect(audioOut());
  src.start();
}

// ============================================================
// Game / match state
// ============================================================
const state = {
  playing: false,
  mode: null,          // 'versus' | 'coop'
  scoreL: 0,           // LEFT goal = opponent / Ronaldo
  scoreR: 0,           // RIGHT goal = you / fish team
  timeLeft: CONFIG.matchSeconds,
  goalCooldown: 0,
};

// Per-mode configuration
const MODES = {
  versus: { ronaldo: false },
  coop:   { ronaldo: true },
};

// Ronaldo difficulty presets (co-op)
const DIFFICULTY = {
  easy:   { speed: 4.5, kickPower: 9 },
  normal: { speed: 6.5, kickPower: 14 },
  hard:   { speed: 8.5, kickPower: 18 },
};

// Room settings chosen on the Create-room screen
const settings = {
  name: '',
  mode: 'versus',
  matchSeconds: 120,
  difficulty: 'normal',
  roomCode: '',
  slot: 0,          // which lobby slot the local player picked
  slotState: [],    // per-slot 'bot' | 'empty' (local slot ignored); empty = no fish
  volume: 0.7,      // master audio volume 0..1
};

const els = {
  score: document.getElementById('score'),
  scoreLabel: document.getElementById('scoreLabel'),
  timer: document.getElementById('timer'),
  hud: document.getElementById('hud'),
  hint: document.getElementById('hint'),
  toast: document.getElementById('toast'),
  goTitle: document.getElementById('goTitle'),
  goScore: document.getElementById('goScore'),
};

const screens = {
  title: document.getElementById('title'),
  settings: document.getElementById('settings'),
  home: document.getElementById('home'),
  create: document.getElementById('create'),
  join: document.getElementById('join'),
  lobby: document.getElementById('lobby'),
  gameover: document.getElementById('gameover'),
};
// name = a screen key, or null for "in game" (all overlays hidden)
function showScreen(name) {
  for (const k in screens) screens[k].classList.toggle('hidden', k !== name);
  const inGame = name === null;
  els.hud.classList.toggle('show', inGame);
  els.hint.classList.toggle('show', inGame);
}

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

// Keep the canvas filling the viewport (also recovers from any stray sizing).
function resizeRenderer() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function resetBall() {
  ball.pos.set(0, CONFIG.ball.radius, 0);
  ball.vel.set(0, 0, 0);
}
function resetRonaldo() {
  ronaldo.pos.set(CONFIG.field.halfX - 4, 0, 0);
  ronaldo.heading = -Math.PI / 2; // face toward the field (-X)
  ronaldo.kickTimer = 0;
}

// Put every fish back on its home side, spread along z by team.
function resetPlayers() {
  const byTeam = {};
  players.forEach((p) => { (byTeam[p.team] = byTeam[p.team] || []).push(p); });
  for (const team in byTeam) {
    const arr = byTeam[team];
    const hx = TEAMS[team].homeX;
    const face = TEAMS[team].attackSide > 0 ? Math.PI / 2 : -Math.PI / 2;
    arr.forEach((p, idx) => {
      const z = (idx - (arr.length - 1) / 2) * 4;
      p.pos.set(hx, p.restY, z);
      p.vel.set(0, 0, 0);
      p.heading = face;
      p.wobble = 0; p.flopTimer = 0; p.charge = 0;
    });
  }
}

const BOT_NAMES = ['ปลาเผา', 'ปลาทู', 'ปลาหมึก', 'ปลาดุก', 'ปลานิล', 'ปลาช่อน'];
function randomSkin() { return FISH_ROSTER[Math.floor(Math.random() * FISH_ROSTER.length)].id; }

function teamOfSlot(mode, slot) {
  return mode === 'coop' ? 'fish' : (slot < 3 ? 'red' : 'blue');
}

// Build the roster of fish for the match.
//  - Offline: local player + AI bots (bots fill non-empty slots).
//  - Online:  local player + remote humans (from Firebase) + host's bots.
async function spawnPlayers() {
  for (const p of players) {
    if (p.root) scene.remove(p.root);
    if (p.label) scene.remove(p.label);
  }
  players = [];
  localPlayer = null;

  // Online clients take the mode + slot layout from the host's room meta.
  const online = net.active;
  const mode = (online && net.meta && net.meta.mode) || settings.mode;
  const count = MODE_SLOTS[mode];
  const localSlot = Math.max(0, Math.min((online ? net.slot : settings.slot) || 0, count - 1));
  const slotState = (online && net.meta && net.meta.slotState) || settings.slotState;
  const me = settings.name.trim() || 'คุณ';

  for (let i = 0; i < count; i++) {
    const team = teamOfSlot(mode, i);
    if (i === localSlot) {
      players.push(makePlayer({ id: i, team, isLocal: true, name: me, skin: selectedFishId }));
      continue;
    }
    // A real player sitting in this slot? (online only)
    const occ = online ? net.players[i] : null;
    if (occ) {
      players.push(makePlayer({
        id: i, team, isRemote: true,
        name: occ.name || ('ปลา ' + (i + 1)), skin: occ.skin || randomSkin(),
      }));
      continue;
    }
    // Otherwise a bot fills the slot, unless it's been closed ('empty').
    if (slotState[i] === 'empty') continue;
    players.push(makePlayer({
      id: i, team, isBot: true,
      name: BOT_NAMES[i % BOT_NAMES.length], skin: randomSkin(),
    }));
  }
  localPlayer = players.find((p) => p.isLocal) || players[0];
  await Promise.all(players.map((p) => attachModel(p, p.skin)));
  resetPlayers();
  // seed network targets so proxies don't lerp from the origin on the first frame
  for (const p of players) { p.netPos.copy(p.pos); p.netHeading = p.heading; }
}

// Start a fresh match using the chosen room settings.
async function startMatch(mode) {
  const cfg = MODES[mode];
  if (!cfg) { console.warn('startMatch: unknown mode', mode); return; }
  state.mode = mode;
  ronaldo.active = !!cfg.ronaldo;

  if (cfg.ronaldo) {
    const d = DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
    RON.speed = d.speed; RON.kickPower = d.kickPower;
  }

  // Score label: red vs blue (versus) or fish team vs Ronaldo (co-op)
  els.scoreLabel.textContent = cfg.ronaldo ? 'ทีมปลา : Ronaldo' : 'แดง : น้ำเงิน';

  state.scoreL = 0; state.scoreR = 0;
  state.timeLeft = settings.matchSeconds;
  state.goalCooldown = 0;
  resetBall(); resetRonaldo();
  await spawnPlayers();
  updateHUD();

  state.playing = true;
  showScreen(null);
  resizeRenderer();               // ensure full-screen canvas on match start
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function restartMatch() { startMatch(state.mode); }

function endMatch() {
  state.playing = false;
  // host แจ้งจบเกมให้ทุกคนเห็นผลพร้อมกัน
  if (net.active && net.isHost) sendWorldForce(buildWorld());
  const you = state.scoreR, cpu = state.scoreL;
  const win = you > cpu, draw = you === cpu;
  const isCoop = state.mode === 'coop';
  // In versus you win/lose based on YOUR team's score.
  const myScore = localPlayer && localPlayer.team === 'blue' ? cpu : you;
  const oppScore = localPlayer && localPlayer.team === 'blue' ? you : cpu;
  const iWon = myScore > oppScore, tie = myScore === oppScore;
  els.goTitle.textContent = (isCoop ? win : iWon) ? 'ชนะแล้ว! 🏆' : (isCoop ? draw : tie) ? 'เสมอ 🤝' : 'แพ้ไปนิดเดียว 😅';
  const left = isCoop ? 'ทีมปลา' : 'แดง';
  const right = isCoop ? 'Ronaldo' : 'น้ำเงิน';
  els.goScore.innerHTML = `สกอร์สุดท้าย &nbsp; <b>${left} ${you} : ${cpu} ${right}</b>`;
  showScreen('gameover');
}

function updateHUD() {
  els.score.textContent = `${state.scoreR} : ${state.scoreL}`;
  const m = Math.floor(state.timeLeft / 60);
  const s = Math.floor(state.timeLeft % 60);
  els.timer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function onGoal(scoringSide) {
  // Ball in the +X goal (side +1) => you/fish team scored (right).
  if (scoringSide > 0) state.scoreR++; else state.scoreL++;
  playGoalSound();
  flashGoal();
  updateHUD();
  state.goalCooldown = 1.2;
  setTimeout(() => {
    if (state.playing) { resetBall(); resetPlayers(); resetRonaldo(); }
  }, 1200);
}

let goalFlash = 0;
function flashGoal() { goalFlash = 1; }

// ============================================================
// Physics step
// ============================================================
// Per-player control: the local fish reads the keyboard; bots use AI.
function controlPlayer(p, dt) {
  if (p.isLocal) {
    if (keys.has('a') || keys.has('arrowleft')) p.heading += CONFIG.turnSpeed * dt;
    if (keys.has('d') || keys.has('arrowright')) p.heading -= CONFIG.turnSpeed * dt;
    if (p.charging) p.charge = Math.min(p.charge + dt, CONFIG.flop.chargeMax);
  } else {
    botControl(p, dt);
  }
  if (p.flopTimer > 0) p.flopTimer -= dt;
}

// Breathing: play a random gasp at roughly a (slightly slow) breath rate.
// Runs for every fish on screen — local, bot, or a networked player.
function breathTick(p, dt) {
  p.breathTimer -= dt;
  if (p.breathTimer <= 0) {
    playBreath(p);
    p.breathTimer = 4.5 + Math.random() * 2.5;   // ~4.5–7s between breaths
  }
}

// Simple bot: aim at the ball (nudged toward its attack goal), flop on a timer.
function botControl(p, dt) {
  const team = TEAMS[p.team];
  const goalX = team.attackSide * CONFIG.field.halfX;
  // aim a little past the ball toward the goal it attacks
  const aimX = ball.pos.x + (goalX - ball.pos.x) * 0.15;
  const aimZ = ball.pos.z;
  const want = Math.atan2(aimX - p.pos.x, aimZ - p.pos.z);
  let da = ((want - p.heading + Math.PI) % (Math.PI * 2)) - Math.PI;
  p.heading += da * Math.min(1, dt * 3.5);

  p.botTimer -= dt;
  if (p.botTimer <= 0 && p.flopTimer <= 0) {
    p.charge = CONFIG.flop.chargeMax * (0.4 + Math.random() * 0.6);
    doFlop(p);
    p.botTimer = 0.35 + Math.random() * 0.5;
  }
}

// Physics integration for one fish.
function stepFish(p, dt) {
  p.vel.y -= CONFIG.gravity * dt;
  p.pos.addScaledVector(p.vel, dt);

  if (p.pos.y <= p.restY) {
    p.pos.y = p.restY;
    if (p.vel.y < 0) p.vel.y = -p.vel.y * CONFIG.groundBounce;
    p.vel.x *= CONFIG.groundFriction;
    p.vel.z *= CONFIG.groundFriction;
    if (Math.abs(p.vel.y) < 0.4) p.vel.y = 0;
  }

  const bx = CONFIG.field.halfX + 0.3, bz = CONFIG.field.halfZ + 0.3;
  if (p.pos.x < -bx) { p.pos.x = -bx; p.vel.x = Math.abs(p.vel.x) * 0.4; }
  if (p.pos.x > bx)  { p.pos.x = bx;  p.vel.x = -Math.abs(p.vel.x) * 0.4; }
  if (p.pos.z < -bz) { p.pos.z = -bz; p.vel.z = Math.abs(p.vel.z) * 0.4; }
  if (p.pos.z > bz)  { p.pos.z = bz;  p.vel.z = -Math.abs(p.vel.z) * 0.4; }

  p.wobble = Math.max(0, p.wobble - dt * 1.8);
}

function stepBall(dt) {
  const B = CONFIG.ball;
  ball.vel.y -= B.gravity * dt;
  ball.vel.multiplyScalar(B.airDrag);
  ball.pos.addScaledVector(ball.vel, dt);

  // Ground
  if (ball.pos.y <= B.radius) {
    ball.pos.y = B.radius;
    if (ball.vel.y < 0) ball.vel.y = -ball.vel.y * B.bounce;
    ball.vel.x *= B.friction;
    ball.vel.z *= B.friction;
    if (Math.abs(ball.vel.y) < 0.3) ball.vel.y = 0;
  }

  // Goal detection BEFORE clamping walls
  if (state.goalCooldown <= 0) {
    for (const g of goals) {
      const crossed = g.side > 0 ? ball.pos.x > g.lineX : ball.pos.x < g.lineX;
      if (crossed &&
          ball.pos.z > g.minZ && ball.pos.z < g.maxZ &&
          ball.pos.y < g.maxY) {
        onGoal(g.side);
        return;
      }
    }
  }

  // Walls (bounce), but let the ball pass through the goal mouth
  const bx = CONFIG.field.halfX, bz = CONFIG.field.halfZ;
  const inGoalMouth = Math.abs(ball.pos.z) < CONFIG.goal.width / 2 - 0.2;
  if (!inGoalMouth) {
    if (ball.pos.x < -bx + B.radius) { ball.pos.x = -bx + B.radius; ball.vel.x = Math.abs(ball.vel.x) * B.bounce; }
    if (ball.pos.x > bx - B.radius)  { ball.pos.x = bx - B.radius;  ball.vel.x = -Math.abs(ball.vel.x) * B.bounce; }
  } else {
    // Behind the goal: stop it eventually
    const outX = CONFIG.field.halfX + CONFIG.goal.depth + 0.6;
    if (ball.pos.x < -outX) { ball.pos.x = -outX; ball.vel.x = 0; }
    if (ball.pos.x > outX)  { ball.pos.x = outX;  ball.vel.x = 0; }
  }
  if (ball.pos.z < -bz + B.radius) { ball.pos.z = -bz + B.radius; ball.vel.z = Math.abs(ball.vel.z) * B.bounce; }
  if (ball.pos.z > bz - B.radius)  { ball.pos.z = bz - B.radius;  ball.vel.z = -Math.abs(ball.vel.z) * B.bounce; }

  // Roll the ball mesh to match horizontal travel
  const speed = Math.hypot(ball.vel.x, ball.vel.z);
  if (speed > 0.01) {
    const axis = new THREE.Vector3(ball.vel.z, 0, -ball.vel.x).normalize();
    ball.mesh.rotateOnWorldAxis(axis, (speed * dt) / B.radius);
  }
}

// Fish <-> ball collision: a fish's body shoves the ball.
function collideFishBall(p) {
  const dx = ball.pos.x - p.pos.x;
  const dz = ball.pos.z - p.pos.z;
  const dy = ball.pos.y - p.pos.y;
  const distXZ = Math.hypot(dx, dz);
  const contactR = CONFIG.ball.radius + 1.3; // fish body reach
  if (distXZ < contactR && Math.abs(dy) < 1.6) {
    const n = new THREE.Vector3(dx, 0, dz);
    if (n.lengthSq() < 1e-4) n.set(Math.sin(p.heading), 0, Math.cos(p.heading));
    n.normalize();
    const fishSpeed = p.vel.length();
    const kick = 3 + fishSpeed * 1.4;
    ball.vel.x += n.x * kick + p.vel.x * 0.6;
    ball.vel.z += n.z * kick + p.vel.z * 0.6;
    ball.vel.y += Math.max(0, p.vel.y * 0.5) + 1.5;
    const overlap = contactR - distXZ;
    ball.pos.x += n.x * overlap;
    ball.pos.z += n.z * overlap;
  }
}

// ============================================================
// Visual: apply flop wobble + orientation to the fish model
// ============================================================
function animateFish(p, t) {
  const r = p.root;
  if (!r) return;
  r.position.copy(p.pos);
  r.rotation.y = p.heading - Math.PI / 2;

  const w = p.wobble;
  const idle = 0.06;
  const amp = idle + w;
  const ph = t + p.phase;                  // per-fish phase so they don't sync
  const airborne = p.pos.y > p.restY + 0.06;
  const fg = p.flopGroup;
  if (fg) {
    fg.rotation.y = Math.sin(ph * 16) * 0.5 * amp;
    fg.rotation.x = Math.sin(ph * 21 + 1.3) * 0.4 * amp + (airborne ? Math.sin(ph * 7) * 0.4 : 0);
    fg.rotation.z = Math.max(0, Math.sin(ph * 12)) * 0.28 * amp;
  }
  if (p.mixer) p.mixer.update(0.016 * (1 + w * 2.5));
  // Name label floats above the head, facing camera automatically (sprite).
  if (p.label) p.label.position.set(p.pos.x, p.pos.y + 2.4, p.pos.z);
}

// ============================================================
// Camera: third-person chase, framing fish + ball
// ============================================================
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
function updateCamera(dt) {
  const p = localPlayer;
  if (!p) return;
  const behind = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
  const desired = p.pos.clone()
    .addScaledVector(behind, -11)   // behind the fish
    .add(new THREE.Vector3(0, 7.5, 0));
  camPos.lerp(desired, 1 - Math.pow(0.001, dt));
  camera.position.copy(camPos);

  // Look a bit ahead of the fish, biased toward the ball
  const look = p.pos.clone().lerp(ball.pos, 0.35);
  look.y += 1.2;
  camTarget.lerp(look, 1 - Math.pow(0.0001, dt));
  camera.lookAt(camTarget);
}

// ============================================================
// Main loop
// ============================================================
const clock = new THREE.Clock();
// ---------- Online sync helpers ----------
const _netTmp = new THREE.Vector3();
function r2(n) { return Math.round(n * 100) / 100; }

// นำข้อมูลจากเน็ต (pos/heading/flop) มาตั้งเป็นเป้าหมายของปลาตัวแทน
function applyNetTo(p, data) {
  if (!data) return;
  if (data.pos) p.netPos.set(data.pos[0], data.pos[1], data.pos[2]);
  if (typeof data.heading === 'number') p.netHeading = data.heading;
  if (typeof data.flop === 'number') {
    if (p.lastFlopSeq && data.flop > p.lastFlopSeq) { p.wobble = 1; p.flopTimer = CONFIG.flop.cooldown; }
    p.lastFlopSeq = data.flop;
  }
}
// ค่อย ๆ เลื่อนปลาตัวแทนเข้าหาเป้าหมาย (นุ่มขึ้น ไม่กระตุก)
function lerpToNet(p, dt) {
  const k = Math.min(1, dt * 12);
  p.pos.lerp(p.netPos, k);
  let da = ((p.netHeading - p.heading + Math.PI) % (Math.PI * 2)) - Math.PI;
  p.heading += da * k;
}
// host รวมสภาพโลก (ลูกบอล + บอท + คะแนน + เวลา) เพื่อกระจายให้ทุกคน
function buildWorld() {
  const bots = {};
  for (const p of players) {
    if (p.isBot) bots[p.id] = { pos: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)], heading: +p.heading.toFixed(3), flop: p.flopSeq || 0 };
  }
  return {
    ball: [r2(ball.pos.x), r2(ball.pos.y), r2(ball.pos.z)], bots,
    scoreL: state.scoreL, scoreR: state.scoreR,
    timeLeft: Math.max(0, state.timeLeft), playing: state.playing,
  };
}
// client อ่านสภาพโลกจาก host มาใช้ (ลูกบอล + คะแนน + เวลา)
function applyWorld(dt) {
  const w = net.world; if (!w) return;
  if (w.ball) ball.pos.lerp(_netTmp.set(w.ball[0], w.ball[1], w.ball[2]), Math.min(1, dt * 12));
  if (w.scoreR > state.scoreR || w.scoreL > state.scoreL) { playGoalSound(); flashGoal(); }
  state.scoreL = w.scoreL || 0; state.scoreR = w.scoreR || 0;
  if (w.timeLeft != null) state.timeLeft = w.timeLeft;
  updateHUD();
  if (w.playing === false || state.timeLeft <= 0) endMatch();
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const now = performance.now();

  if (state.playing) {
    const online = net.active;
    if (!online || net.isHost) {
      // ออฟไลน์ หรือ host: จำลองทุกอย่าง (ยกเว้นปลาคนอื่นที่อ่านจากเน็ต)
      for (const p of players) {
        if (p.isRemote) { applyNetTo(p, net.players[p.id]); lerpToNet(p, dt); }
        else { controlPlayer(p, dt); stepFish(p, dt); }
      }
      stepRonaldo(dt);
      stepBall(dt);
      for (const p of players) collideFishBall(p);
      if (state.goalCooldown > 0) state.goalCooldown -= dt;
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) { state.timeLeft = 0; updateHUD(); endMatch(); }
      else updateHUD();
    } else {
      // client: คุมปลาตัวเอง อ่านที่เหลือจากเน็ต
      for (const p of players) {
        if (p.isLocal) { controlPlayer(p, dt); stepFish(p, dt); }
        else if (p.isRemote) { applyNetTo(p, net.players[p.id]); lerpToNet(p, dt); }
        else if (p.isBot) { applyNetTo(p, net.world && net.world.bots && net.world.bots[p.id]); lerpToNet(p, dt); }
      }
      applyWorld(dt);
    }
    if (online) {
      if (localPlayer) sendMe(localPlayer, now);
      if (net.isHost) sendWorld(buildWorld(), now);
    }
    for (const p of players) breathTick(p, dt);
  }

  for (const p of players) animateFish(p, t);
  animateHuman(t);
  ball.mesh.position.copy(ball.pos);
  updateCamera(dt);

  // Goal flash tint
  if (goalFlash > 0) {
    goalFlash = Math.max(0, goalFlash - dt * 1.5);
    scene.background.setRGB(0.53 + goalFlash * 0.4, 0.81, 0.92 - goalFlash * 0.3);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// ============================================================
// Boot
// ============================================================
async function boot() {
  buildSkinPicker();
  loadBreathSounds();   // decode breath clips in the background

  // A single local player exists from the start (menu preview).
  localPlayer = makePlayer({ id: 0, team: 'red', isLocal: true, name: 'คุณ', skin: selectedFishId });
  players = [localPlayer];

  const [, h] = await Promise.all([attachModel(localPlayer, selectedFishId), loadHuman()]);
  localPlayer.pos.set(0, localPlayer.restY, 0);

  ronaldo.root = h.root;
  ronaldo.bones = h.bones || null;
  ronaldo.rest = h.rest || null;
  ronaldo.root.visible = false;
  scene.add(ronaldo.root);

  resetBall();
  resetRonaldo();
  updateHUD();
  camPos.copy(camera.position);
  resizeRenderer();
  showScreen('title');
  tick();
}

// ---------- Menu / screen navigation ----------
function goToMenu() {
  state.playing = false;
  ronaldo.active = false;
  if (net.active) leaveRoom();   // ออกจากห้องออนไลน์
  showScreen('title');
}

// Build the fish-skin picker (lives on the Create-room screen)
function buildSkinPicker() {
  const wrap = document.getElementById('skinPicker');
  if (!wrap) return;
  wrap.innerHTML = '';
  FISH_ROSTER.forEach((f) => {
    const b = document.createElement('button');
    b.className = 'skin-chip' + (f.id === selectedFishId ? ' active' : '');
    b.dataset.id = f.id;
    b.innerHTML = `<span class="skin-emoji">${f.emoji}</span><span>${f.name}</span>`;
    b.addEventListener('click', async () => {
      wrap.querySelectorAll('.skin-chip').forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
      b.classList.add('loading');
      await setFish(f.id);
      b.classList.remove('loading');
    });
    wrap.appendChild(b);
  });
}

// Segmented control: wire one .seg group, calling onPick(value) on select.
function wireSeg(segId, key, onPick) {
  const seg = document.getElementById(segId);
  seg.querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      seg.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      onPick(b.dataset[key]);
    });
  });
}

function genRoomCode() { return String(Math.floor(1000 + Math.random() * 9000)); }

function openCreate() {
  settings.roomCode = genRoomCode();
  document.getElementById('roomCodeText').textContent = settings.roomCode;
  document.getElementById('diffGroup').style.display = settings.mode === 'coop' ? '' : 'none';
  showScreen('create');
}

// Title screen → Start (room flow) / Setting (volume)
document.getElementById('startBtn').addEventListener('click', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  showScreen('home');
});
document.getElementById('settingBtn').addEventListener('click', () => showScreen('settings'));

// Settings screen — volume only
const volSlider = document.getElementById('volSlider');
const volVal = document.getElementById('volVal');
volSlider.value = String(Math.round(settings.volume * 100));
volVal.textContent = volSlider.value + '%';
volSlider.addEventListener('input', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  setVolume(parseInt(volSlider.value, 10) / 100);
  volVal.textContent = volSlider.value + '%';
});
document.getElementById('settingsBack').addEventListener('click', () => showScreen('title'));

// Home screen
const nameInput = document.getElementById('playerName');
nameInput.addEventListener('input', () => { settings.name = nameInput.value; });
document.getElementById('toCreate').addEventListener('click', openCreate);
document.getElementById('toJoin').addEventListener('click', () => {
  document.getElementById('joinCode').value = '';
  showScreen('join');
});

// Create-room settings
wireSeg('modeSeg', 'mode', (v) => {
  settings.mode = v;
  document.getElementById('diffGroup').style.display = v === 'coop' ? '' : 'none';
});
wireSeg('timeSeg', 'sec', (v) => { settings.matchSeconds = parseInt(v, 10); });
wireSeg('diffSeg', 'diff', (v) => { settings.difficulty = v; });
// Host: settings → lobby (to pick a slot) → start
document.getElementById('startGameBtn').addEventListener('click', () => openLobby(true));
document.getElementById('createBack').addEventListener('click', () => showScreen('home'));
document.getElementById('copyCodeBtn').addEventListener('click', () => {
  if (navigator.clipboard) navigator.clipboard.writeText(settings.roomCode).catch(() => {});
  toast('คัดลอกเลขห้อง ' + settings.roomCode);
});

// Join-room: enter code → lobby directly (joiner doesn't see settings)
document.getElementById('joinBack').addEventListener('click', () => showScreen('home'));
document.getElementById('joinGoBtn').addEventListener('click', () => {
  const code = document.getElementById('joinCode').value.trim();
  if (code.length < 4) { toast('ใส่เลขห้อง 4 ตัวก่อน'); return; }
  settings.roomCode = code;
  settings.mode = 'versus';   // ค่าเริ่มต้น (ออนไลน์จะรับโหมดจริงจาก host)
  openLobby(false);
});

// ---------- Lobby (pick your slot / side) ----------
// ข้อมูล presence ของตัวเราสำหรับช่องหนึ่ง ๆ
function presenceFor(slot) {
  const mode = (net.active && net.meta && net.meta.mode) || settings.mode;
  return {
    name: settings.name.trim() || 'คุณ', team: teamOfSlot(mode, slot),
    skin: selectedFishId, host: net.isHost, pos: [0, 0.6, 0], heading: 1.57, flop: 0,
  };
}

async function openLobby(isHost) {
  settings.slot = 0;
  let count = MODE_SLOTS[settings.mode];
  settings.slotState = Array(count).fill('bot');   // default: fill others with bots

  const online = netAvailable();
  if (online && !isHost) settings.slot = -1;   // joiner ยังไม่เลือกช่อง
  document.getElementById('lobbyCode').textContent = settings.roomCode || '----';
  document.getElementById('lobbyTag').textContent = settings.mode === 'coop' ? '🤝 ร่วมมือกัน' : '⚔️ แข่งกันเอง';
  document.getElementById('lobbyNote').textContent = !online
    ? '* แตะช่องเพื่อย้ายตัวเอง · ปุ่มขวาสลับ บอท/ปิดช่อง — เล่นกับบอท (ออฟไลน์)'
    : (isHost
      ? '* ออนไลน์: แชร์เลขห้องให้เพื่อน · แตะช่องเพื่อย้าย · ปุ่มขวาสลับ บอท/ปิดช่อง'
      : '* ออนไลน์: แตะช่องว่างเพื่อนั่ง แล้วกดเริ่มเกม');
  showScreen('lobby');
  buildLobby();

  if (!online) return;

  // ต่อเข้าห้อง Firebase
  if (isHost) {
    const meta = {
      mode: settings.mode, sec: settings.matchSeconds, diff: settings.difficulty,
      slotState: settings.slotState, hostSlot: 0, started: false,
    };
    await connectRoom({ code: settings.roomCode, isHost: true, slot: 0, meta, presence: presenceFor(0) });
  } else {
    settings.slot = -1;   // joiner ยังไม่เลือกช่อง จนกว่าจะแตะ
    await connectRoom({ code: settings.roomCode, isHost: false });
  }
  onPlayers(syncLobbyFromNet);
  setTimeout(syncLobbyFromNet, 500);   // เผื่อ meta มาช้า
}

// อัปเดตล็อบบี้จากข้อมูลเน็ต (host meta + ผู้เล่นในห้อง)
function syncLobbyFromNet() {
  if (!net.active && !net.code) return;
  if (screens.lobby.classList.contains('hidden')) return;   // อัปเดตเฉพาะตอนอยู่ล็อบบี้
  // joiner รับโหมด/ตั้งค่าจาก host
  if (!net.isHost && net.meta) {
    settings.mode = net.meta.mode || settings.mode;
    settings.matchSeconds = net.meta.sec || settings.matchSeconds;
    settings.difficulty = net.meta.diff || settings.difficulty;
    const count = MODE_SLOTS[settings.mode];
    settings.slotState = (net.meta.slotState && net.meta.slotState.slice(0, count)) || Array(count).fill('bot');
    document.getElementById('lobbyTag').textContent = settings.mode === 'coop' ? '🤝 ร่วมมือกัน' : '⚔️ แข่งกันเอง';
  }
  buildLobby();
}

// Render the slot picker. Tap a slot body to move yourself there; the small
// toggle switches that slot between a bot and an empty (closed) slot.
function buildLobby() {
  const body = document.getElementById('lobbyBody');
  body.innerHTML = '';
  const me = settings.name.trim() || 'คุณ';

  const online = net.active || (!!net.code && !net.isHost);
  const mkSlot = (idx, team, botLabel) => {
    const mine = settings.slot === idx;
    const st = settings.slotState[idx];
    // ผู้เล่นจริงคนอื่นนั่งช่องนี้อยู่ไหม (ออนไลน์)
    const occ = online && net.players[idx] && idx !== net.slot ? net.players[idx] : null;
    const row = document.createElement('div');
    row.className = `slot ${team}` + (mine ? ' mine' : occ ? ' taken' : (st === 'empty' ? ' empty' : ' bot'));

    const label = mine ? '★ ' + me : occ ? ('👤 ' + (occ.name || 'ผู้เล่น')) : (st === 'empty' ? 'ว่าง' : botLabel);
    const info = document.createElement('span');
    info.className = 'slot-info';
    info.innerHTML = `<span class="dot"></span><span>${label}</span>`;
    info.addEventListener('click', async () => {
      if (mine || occ) return;   // นั่งช่องตัวเอง/ช่องคนอื่นไม่ได้
      const old = settings.slot;
      settings.slot = idx;
      if (!online || net.isHost) { if (old >= 0) settings.slotState[old] = 'bot'; }
      if (online) {
        await claimSlot(idx, presenceFor(idx));
        if (net.isHost) updateMeta({ slotState: settings.slotState, hostSlot: idx });
      }
      buildLobby();
    });
    row.appendChild(info);

    // ปุ่มสลับ บอท/ปิดช่อง — เจ้าของห้องเท่านั้น (ออฟไลน์ก็ได้)
    const canToggle = !mine && !occ && (!online || net.isHost);
    if (canToggle) {
      const tg = document.createElement('button');
      tg.className = 'slot-toggle';
      tg.textContent = st === 'empty' ? '＋' : '✕';
      tg.title = st === 'empty' ? 'ใส่บอท' : 'ปิดช่อง';
      tg.addEventListener('click', (e) => {
        e.stopPropagation();
        settings.slotState[idx] = st === 'empty' ? 'bot' : 'empty';
        if (online && net.isHost) updateMeta({ slotState: settings.slotState });
        buildLobby();
      });
      row.appendChild(tg);
    }
    return row;
  };

  if (settings.mode === 'coop') {
    const col = document.createElement('div'); col.className = 'team-col';
    const head = document.createElement('div'); head.className = 'team-head fish';
    head.textContent = '🐟 ทีมปลา (สู้ Ronaldo)'; col.appendChild(head);
    for (let i = 0; i < 3; i++) col.appendChild(mkSlot(i, 'fish', 'บอท ' + (i + 1)));
    body.appendChild(col);
  } else {
    const teams = [['red', '🔴 ฝั่งแดง (ซ้าย)', 0], ['blue', '🔵 ฝั่งน้ำเงิน (ขวา)', 3]];
    teams.forEach(([team, title, base]) => {
      const col = document.createElement('div'); col.className = 'team-col';
      const head = document.createElement('div'); head.className = 'team-head ' + team;
      head.textContent = title; col.appendChild(head);
      for (let i = 0; i < 3; i++) col.appendChild(mkSlot(base + i, team, 'บอท ' + (base + i + 1)));
      body.appendChild(col);
    });
  }
}
document.getElementById('lobbyStart').addEventListener('click', async () => {
  // ออนไลน์: ต้องนั่งช่องก่อน (joiner ที่ยังไม่เลือก)
  if (netAvailable() && net.code) {
    if (settings.slot < 0 || (!net.active)) {
      const count = MODE_SLOTS[(net.meta && net.meta.mode) || settings.mode];
      let open = -1;
      for (let i = 0; i < count; i++) { if (!net.players[i]) { open = i; break; } }
      if (open < 0) { toast('ห้องเต็มแล้ว'); return; }
      settings.slot = open;
      await claimSlot(open, presenceFor(open));
    }
    if (net.isHost) updateMeta({ started: true });
  }
  startMatch((net.active && net.meta && net.meta.mode) || settings.mode);
});
document.getElementById('lobbyBack').addEventListener('click', () => { if (net.active) leaveRoom(); showScreen('home'); });

// Game over — เล่นอีกครั้ง (ออนไลน์กลับเมนูเพราะต้องตั้งห้องใหม่)
document.getElementById('againBtn').addEventListener('click', () => { if (net.active) goToMenu(); else restartMatch(); });
document.getElementById('menuBtn').addEventListener('click', goToMenu);

// Fullscreen toggle (button + F key)
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  } else if (document.exitFullscreen) {
    document.exitFullscreen();
  }
}
document.getElementById('fsBtn').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', resizeRenderer);

// Debug hook (for automated testing; harmless in normal play)
window.__debug = {
  get players() { return players; },
  get localPlayer() { return localPlayer; },
  ball, ronaldo, state, settings, goals, CONFIG, FISH_ROSTER, TEAMS,
  stepFish, stepRonaldo, stepBall, collideFishBall, doFlop, onGoal,
  resetBall, resetPlayers, resetRonaldo, startMatch, setFish, spawnPlayers,
  showScreen, toggleFullscreen, buildLobby,
  playBreath, get breathCount() { return breathBuffers.filter(Boolean).length; },
  renderer, scene, camera, animateFish, animateHuman, updateCamera,
};

window.addEventListener('resize', resizeRenderer);

boot();
