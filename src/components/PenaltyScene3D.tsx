"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { useAnimations } from "@react-three/drei";
import { FBXLoader, SkeletonUtils } from "three-stdlib";
import * as THREE from "three";
import {
  GOAL_Z, GOAL_W, HALF_W, GOAL_H, POST_R, NET_DEPTH,
  CAM_POS, CAM_LOOK, BALL_HOME, FLIGHT_TIME,
  zone3DTarget,
} from "@/lib/penalty3d";

// ── Public props ──────────────────────────────────────────────────────────────

export interface PenaltyScene3DProps {
  phase?: "aim" | "flying" | "result";
  zone?: number | null;
  keeperCol?: number;
  isGoal?: boolean;
}

// ── Animation file per zone ───────────────────────────────────────────────────
// 9 zones (3×3): row 0=top, row 1=mid, row 2=bottom; col 0=left, 1=center, 2=right

const ANIM_CLIPS = [
  { name: "arriba-izquierda", path: "/Goalkeeper arriba izquierda.fbx" },
  { name: "arriba",           path: "/Goalkeeper arriba.fbx"           },
  { name: "arriba-derecha",   path: "/Goalkeeper arriba derecha.fbx"   },
  { name: "izquierda",        path: "/goalkeeper izquierda.fbx"        },
  { name: "medio",            path: "/Goalkeeper medio.fbx"            },
  { name: "derecha",          path: "/goalkeeper derecha.fbx"          },
  { name: "abajo",            path: "/Goalkeeper abajo.fbx"            },
] as const;

const ANIM_PATHS = ANIM_CLIPS.map(a => a.path);

// Random animation based on keeper's guess column (not ball zone).
// col 0/2 are in PLAYER space. Keeper rotation=[0,0,0] so animations are NOT mirrored:
// keeperCol=0 (player's left)  → keeper dives to player's left  → "izquierda" animation
// keeperCol=2 (player's right) → keeper dives to player's right → "derecha" animation
function keeperColToClip(col: number): string {
  const r = Math.random();
  if (col === 0) return r < 0.55 ? "izquierda" : "arriba-izquierda";
  if (col === 2) return r < 0.55 ? "derecha"   : "arriba-derecha";
  // center column: mix of medio, arriba, abajo
  if (r < 0.45) return "medio";
  if (r < 0.75) return "arriba";
  return "abajo";
}

// ── Canvas textures ───────────────────────────────────────────────────────────

function useGrassTexture() {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 ? "#2f8a36" : "#2a7d31";
      g.fillRect(0, i * 32, 512, 32);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 5);
    return t;
  }, []);
}

function useNetTexture(rx: number, ry: number) {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.strokeStyle = "rgba(255,255,255,.55)";
    g.lineWidth = 1.4;
    for (let i = 0; i <= 64; i += 8) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    return t;
  }, [rx, ry]);
}

// ── Ground ────────────────────────────────────────────────────────────────────

function Ground() {
  const map = useGrassTexture();
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[60, 60]} />
      <meshStandardMaterial map={map} roughness={1} />
    </mesh>
  );
}

// ── Stadium backdrop ──────────────────────────────────────────────────────────

function Backdrop() {
  return (
    <mesh position={[0, 11, GOAL_Z - 7]}>
      <planeGeometry args={[60, 22]} />
      <meshStandardMaterial color="#0c1838" roughness={1} />
    </mesh>
  );
}

// ── Net ───────────────────────────────────────────────────────────────────────

function Net() {
  const backTex = useNetTexture(12, 4);
  const topTex  = useNetTexture(12, 2);
  const sideTex = useNetTexture(2, 4);

  const backMat = useMemo(() => new THREE.MeshBasicMaterial(
    { map: backTex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
  [backTex]);
  const topMat = useMemo(() => new THREE.MeshBasicMaterial(
    { map: topTex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
  [topTex]);
  const sideMat = useMemo(() => new THREE.MeshBasicMaterial(
    { map: sideTex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
  [sideTex]);

  return (
    <>
      <mesh position={[0, GOAL_H / 2, -NET_DEPTH]} material={backMat}>
        <planeGeometry args={[GOAL_W, GOAL_H]} />
      </mesh>
      <mesh position={[0, GOAL_H, -NET_DEPTH / 2]} rotation={[-Math.PI / 2, 0, 0]} material={topMat}>
        <planeGeometry args={[GOAL_W, NET_DEPTH]} />
      </mesh>
      <mesh position={[-HALF_W, GOAL_H / 2, -NET_DEPTH / 2]} rotation={[0, Math.PI / 2, 0]} material={sideMat}>
        <planeGeometry args={[NET_DEPTH, GOAL_H]} />
      </mesh>
      <mesh position={[HALF_W, GOAL_H / 2, -NET_DEPTH / 2]} rotation={[0, -Math.PI / 2, 0]} material={sideMat}>
        <planeGeometry args={[NET_DEPTH, GOAL_H]} />
      </mesh>
    </>
  );
}

// ── Goal ──────────────────────────────────────────────────────────────────────

function Goal() {
  const postMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "white", roughness: 0.4, metalness: 0.1 }),
  []);
  return (
    <group position={[0, 0, GOAL_Z]}>
      <mesh position={[-HALF_W, GOAL_H / 2, 0]} castShadow material={postMat}>
        <cylinderGeometry args={[POST_R, POST_R, GOAL_H, 16]} />
      </mesh>
      <mesh position={[HALF_W, GOAL_H / 2, 0]} castShadow material={postMat}>
        <cylinderGeometry args={[POST_R, POST_R, GOAL_H, 16]} />
      </mesh>
      <mesh position={[0, GOAL_H, 0]} rotation={[0, 0, Math.PI / 2]} castShadow material={postMat}>
        <cylinderGeometry args={[POST_R, POST_R, GOAL_W + POST_R * 2, 16]} />
      </mesh>
      <Net />
    </group>
  );
}

// ── Penalty spot ──────────────────────────────────────────────────────────────

function PenaltySpot() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <circleGeometry args={[0.12, 20]} />
      <meshStandardMaterial color="white" roughness={1} />
    </mesh>
  );
}

// ── Lights ────────────────────────────────────────────────────────────────────

function Lights() {
  return (
    <>
      <hemisphereLight args={[0x88aaff as unknown as THREE.ColorRepresentation, 0x223b1f as unknown as THREE.ColorRepresentation, 0.55]} />
      <directionalLight
        position={[-6, 12, 6]}
        intensity={1.15}
        castShadow
        shadow-bias={-0.0004}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <directionalLight position={[6, 8, -10]} intensity={0.5} color="#bcd2ff" />
    </>
  );
}

// ── Goalkeeper ────────────────────────────────────────────────────────────────

// Goalkeeper kit shader — colors the single-mesh Mixamo FBX by bind-pose Y
// (object-space cm before skinning) so the kit follows the skeleton properly.
// Y thresholds are for the standard Mixamo Beta character (170 cm model):
//   > 155 → head/skin   105-155 → jersey (lime)   72-105 → shorts (navy)
//   38-72 → socks       < 38    → boots
// Gloves: Y 75-125 AND |X| > 60 → bright orange.
function makeKeeperMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.0 });

  mat.onBeforeCompile = (shader) => {
    shader.vertexShader   = `varying vec2 vKitPos;\n`   + shader.vertexShader;
    shader.fragmentShader = `varying vec2 vKitPos;\n` + shader.fragmentShader;

    // Sample bind-pose position BEFORE skinning_vertex applies bone transforms
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       vKitPos = vec2(transformed.x, transformed.y);`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
       {
         float ky = vKitPos.y;
         float kx = abs(vKitPos.x);
         bool isGlove = (ky > 75.0 && ky < 125.0 && kx > 60.0);
         vec3 kitCol;
         if (ky > 155.0) {
           kitCol = vec3(0.93, 0.73, 0.52);   // head — skin
         } else if (isGlove) {
           kitCol = vec3(1.0, 0.48, 0.04);    // gloves — orange
         } else if (ky > 105.0) {
           kitCol = vec3(0.70, 0.92, 0.02);   // jersey — lime yellow
         } else if (ky > 72.0) {
           kitCol = vec3(0.04, 0.08, 0.44);   // shorts — navy
         } else if (ky > 38.0) {
           kitCol = vec3(0.88, 0.90, 0.94);   // socks — light grey
         } else {
           kitCol = vec3(0.07, 0.07, 0.12);   // boots — near black
         }
         diffuseColor.rgb = kitCol;
       }`,
    );
  };

  return mat;
}

function Keeper({
  keeperRef,
  phase,
  keeperCol,
}: {
  keeperRef: React.RefObject<THREE.Group>;
  phase: "aim" | "flying" | "result";
  keeperCol: number;
}) {
  // Primary model — provides the mesh + skeleton structure.
  // useLoader returns the same cached THREE.Group for all callers; clone it so
  // each Canvas instance gets its own object (THREE.js objects can only have one parent).
  const rawPrimaryFbx = useLoader(FBXLoader, "/Goalkeeper medio.fbx") as THREE.Group;
  const primaryFbx = useMemo(() => SkeletonUtils.clone(rawPrimaryFbx) as THREE.Group, [rawPrimaryFbx]);

  // All 7 animation FBX files loaded in parallel (useLoader caches them)
  const animFbxs = useLoader(FBXLoader, ANIM_PATHS) as THREE.Group[];

  // Extract one named clip from each animation FBX.
  // Zero out the Hips Z track so the keeper stays in front of the net
  // (root-bone Z motion would push the character backward into the net).
  const clips = useMemo(() => {
    return ANIM_CLIPS.map(({ name }, i) => {
      const src = animFbxs[i]?.animations[0];
      if (!src) return null;
      const clip = src.clone();
      clip.name = name;

      clip.tracks = clip.tracks.map(track => {
        if (/hips\.position/i.test(track.name)) {
          const vt = track as THREE.VectorKeyframeTrack;
          const vals = Float32Array.from(vt.values);
          // Zero every Z component (index 2, 5, 8 … in x,y,z triplets)
          for (let j = 2; j < vals.length; j += 3) vals[j] = 0;
          return new THREE.VectorKeyframeTrack(
            track.name,
            Array.from(vt.times),
            Array.from(vals),
          );
        }
        return track;
      });

      return clip;
    }).filter(Boolean) as THREE.AnimationClip[];
  }, [animFbxs]);

  const { actions } = useAnimations(clips, keeperRef);

  const keeperMat = useMemo(() => makeKeeperMaterial(), []);

  useEffect(() => {
    primaryFbx.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = keeperMat;
        mesh.castShadow = true;
      }
    });
  }, [primaryFbx, keeperMat]);

  // Track phase transitions to trigger animation
  const prevPhase = useRef<string>("aim");
  const activeClip = useRef<string>("medio");

  useFrame(() => {
    const cur  = phase;
    const prev = prevPhase.current;

    if (cur === "flying" && prev !== "flying") {
      // Choose a random clip that matches the keeper's guess direction
      const clipName = keeperColToClip(keeperCol);
      activeClip.current = clipName;

      const action = actions[clipName];
      if (action) {
        // Stop any running action first
        Object.values(actions).forEach(a => a?.stop());
        action.reset().setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.timeScale = 1.3;
        action.play();
      }
    } else if (cur === "aim" && prev !== "aim") {
      Object.values(actions).forEach(a => a?.stop());
    }

    prevPhase.current = cur;
  });

  return (
    <group ref={keeperRef} position={[0, 0, GOAL_Z + 0.45]}>
      <primitive object={primaryFbx} scale={0.012} rotation={[0, 0, 0]} />
    </group>
  );
}

// ── Ball — procedural soccer ball shader ──────────────────────────────────────
// Pattern: 12 black pentagons at icosahedron vertices + white hexagons.
// vObjN (object-space normal) drives the pattern so it spins with ball.rotation.

const BALL_VERT = /* glsl */`
  varying vec3 vObjN;
  varying vec3 vN;
  varying vec3 vViewPos;
  void main() {
    vObjN       = normalize(normal);
    vN          = normalize(normalMatrix * normal);
    vec4 mv     = modelViewMatrix * vec4(position, 1.0);
    vViewPos    = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const BALL_FRAG = /* glsl */`
  #define PHI 1.6180339887
  varying vec3 vObjN;
  varying vec3 vN;
  varying vec3 vViewPos;

  // Update d1/d2 with dot product of p against a new icosahedron vertex
  void chk(vec3 p, vec3 v, inout float d1, inout float d2) {
    float d = dot(p, normalize(v));
    if      (d > d1) { d2 = d1; d1 = d; }
    else if (d > d2) { d2 = d; }
  }

  void main() {
    vec3 p = normalize(vObjN);  // object-space → pattern rotates with ball
    vec3 n = normalize(vN);     // view-space   → lighting

    // Find two closest icosahedron vertices (12 pentagon centers)
    float d1 = -2.0, d2 = -2.0;
    chk(p, vec3( 0.0,  1.0,  PHI), d1, d2);
    chk(p, vec3( 0.0, -1.0,  PHI), d1, d2);
    chk(p, vec3( 0.0,  1.0, -PHI), d1, d2);
    chk(p, vec3( 0.0, -1.0, -PHI), d1, d2);
    chk(p, vec3( 1.0,  PHI,  0.0), d1, d2);
    chk(p, vec3(-1.0,  PHI,  0.0), d1, d2);
    chk(p, vec3( 1.0, -PHI,  0.0), d1, d2);
    chk(p, vec3(-1.0, -PHI,  0.0), d1, d2);
    chk(p, vec3( PHI,  0.0,  1.0), d1, d2);
    chk(p, vec3(-PHI,  0.0,  1.0), d1, d2);
    chk(p, vec3( PHI,  0.0, -1.0), d1, d2);
    chk(p, vec3(-PHI,  0.0, -1.0), d1, d2);

    // Seam: where two vertices are equidistant → panel edge
    float edge  = 1.0 - smoothstep(0.0, 0.04, d1 - d2);
    // Pentagon fill: very close to an icosahedron vertex
    float penta = smoothstep(0.91, 0.945, d1);
    float dark  = max(edge, penta);

    vec3 base = mix(vec3(1.0), vec3(0.06), dark);

    // Phong lighting (fixed scene light direction)
    vec3 L   = normalize(vec3(-0.5, 1.0, 0.5));
    vec3 V   = normalize(vViewPos);
    float dif = clamp(dot(n, L), 0.0, 1.0) * 1.05 + 0.38;
    float spc = pow(clamp(dot(reflect(-L, n), V), 0.0, 1.0), 28.0) * 0.45;

    gl_FragColor = vec4(base * dif + spc, 1.0);
  }
`;

function Ball({ ballRef }: { ballRef: React.RefObject<THREE.Mesh> }) {
  const mat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: BALL_VERT, fragmentShader: BALL_FRAG }),
    [],
  );
  return (
    <mesh ref={ballRef} position={[BALL_HOME[0], BALL_HOME[1], BALL_HOME[2]]} castShadow>
      <sphereGeometry args={[0.12, 32, 32]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

// ── Scene + animation loop ────────────────────────────────────────────────────

function Scene({ phase = "aim", zone = null, keeperCol = 1, isGoal = false }: PenaltyScene3DProps) {
  const ballRef   = useRef<THREE.Mesh>(null);
  const keeperRef = useRef<THREE.Group>(null);

  const flyStart  = useRef(0);
  const arcH      = useRef(0.65);
  const shakeT    = useRef(0);
  const prevPhase = useRef("aim");
  const ballEnd   = useRef(new THREE.Vector3());
  const ballStart = useRef(new THREE.Vector3(BALL_HOME[0], BALL_HOME[1], BALL_HOME[2]));

  useFrame(({ camera, clock }) => {
    const t = clock.getElapsedTime();

    if (phase === "flying" && prevPhase.current !== "flying") {
      flyStart.current = t;
      arcH.current = 0.55 + Math.random() * 0.25;
      if (zone !== null) {
        const tgt = zone3DTarget(zone);
        ballEnd.current.set(tgt[0], tgt[1], tgt[2]);
      }
    }
    prevPhase.current = phase;

    // Camera sway + shake
    let sx = Math.sin(t * 0.6) * 0.04;
    let sy = Math.cos(t * 0.45) * 0.03;
    if (shakeT.current > 0) {
      shakeT.current = Math.max(shakeT.current - 1 / 60, 0);
      sx += (Math.random() - 0.5) * 0.12;
      sy += (Math.random() - 0.5) * 0.12;
    }
    camera.position.set(CAM_POS[0] + sx, CAM_POS[1] + sy, CAM_POS[2]);
    camera.lookAt(CAM_LOOK[0], CAM_LOOK[1], CAM_LOOK[2]);

    if (!ballRef.current || !keeperRef.current) return;
    const ball   = ballRef.current;
    const keeper = keeperRef.current;

    // AIM: reset positions
    if (phase === "aim") {
      ball.position.set(BALL_HOME[0], BALL_HOME[1], BALL_HOME[2]);
      ball.rotation.set(0, 0, 0);
      keeper.position.set(0, 0, GOAL_Z + 0.45);
      keeper.rotation.set(0, 0, 0);
      return;
    }

    if (zone === null) return;

    // FLYING: ball arc — keeper position handled by skeletal animation
    if (phase === "flying") {
      const p = Math.min((t - flyStart.current) / FLIGHT_TIME, 1);
      ball.position.lerpVectors(ballStart.current, ballEnd.current, p);
      ball.position.y += Math.sin(p * Math.PI) * arcH.current;
      ball.rotation.x -= 0.4;
      ball.rotation.y -= 0.2;

      if (p >= 1 && isGoal && shakeT.current <= 0) {
        shakeT.current = 0.35;
      }
      return;
    }

    // RESULT: freeze ball
    if (phase === "result") {
      const tgt = zone3DTarget(zone);
      if (isGoal) {
        ball.position.set(tgt[0], tgt[1], tgt[2] - 0.4);
      } else {
        ball.position.set(tgt[0] * 0.7, Math.max(tgt[1], 0.95), GOAL_Z + 0.55);
      }
    }
  });

  return (
    <>
      <Lights />
      <Ground />
      <Backdrop />
      <Goal />
      <PenaltySpot />
      <Ball ballRef={ballRef} />
      <Keeper keeperRef={keeperRef} phase={phase} keeperCol={keeperCol} />
    </>
  );
}

// ── Canvas export ─────────────────────────────────────────────────────────────

export default function PenaltyScene3D(props: PenaltyScene3DProps) {
  return (
    <div style={{ width: "100%", height: 320 }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [CAM_POS[0], CAM_POS[1], CAM_POS[2]], fov: 55 }}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          gl.shadowMap.type = THREE.PCFShadowMap;
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <color attach="background" args={["#0a1330"]} />
        <fog attach="fog" args={["#0a1330", 8, 20]} />
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
