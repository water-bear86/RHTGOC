import * as THREE from "three"

export interface SherwoodWater {
  group: THREE.Group
  surface: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  update: (elapsedSeconds: number, motionScale: number) => void
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  varying vec3 vWorldPosition;
  varying float vWave;

  void main() {
    vec3 displaced = position;
    float along = position.y;
    float across = position.x;
    float waveA = sin(along * 0.82 + uTime * 1.35);
    float waveB = sin(along * 1.75 - across * 2.4 - uTime * 0.9);
    float waveC = cos(across * 4.2 + uTime * 1.7);
    vWave = waveA * 0.52 + waveB * 0.31 + waveC * 0.17;
    displaced.z += vWave * 0.055 * uMotion;
    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vWorldPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  varying vec3 vWorldPosition;
  varying float vWave;

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - clamp(abs(viewDirection.y), 0.0, 1.0), 2.2);
    float rippleA = sin(vWorldPosition.z * 2.8 + vWorldPosition.x * 5.2 - uTime * 2.0);
    float rippleB = sin(vWorldPosition.z * 6.4 - vWorldPosition.x * 2.1 + uTime * 2.7);
    float ripples = smoothstep(0.72, 1.0, rippleA * 0.62 + rippleB * 0.38);
    float movingGlint = pow(max(0.0, sin(vWorldPosition.z * 1.15 - uTime * 1.8 + vWave * 2.0)), 10.0);
    vec3 deepWater = vec3(0.025, 0.18, 0.24);
    vec3 skyReflection = vec3(0.36, 0.64, 0.68);
    vec3 color = mix(deepWater, skyReflection, 0.25 + fresnel * 0.62);
    color += vec3(0.22, 0.48, 0.46) * ripples * (0.10 + 0.22 * uMotion);
    color += vec3(1.0, 0.88, 0.52) * movingGlint * 0.48 * uMotion;
    gl_FragColor = vec4(color, 0.92 + fresnel * 0.06);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function createSherwoodWater(width = 5, length = 54): SherwoodWater {
  const group = new THREE.Group()
  group.name = "SherwoodRiver"

  const bed = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    new THREE.MeshToonMaterial({ color: 0x234d55 }),
  )
  bed.position.z = -0.035
  bed.receiveShadow = true
  bed.name = "RiverBed"

  const uniforms = {
    uTime: { value: 0 },
    uMotion: { value: 1 },
  }
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length, 12, 96),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  surface.position.z = 0.015
  surface.renderOrder = 2
  surface.name = "AnimatedWaterSurface"
  group.add(bed, surface)

  return {
    group,
    surface,
    update(elapsedSeconds, motionScale) {
      uniforms.uTime.value = elapsedSeconds
      uniforms.uMotion.value = Math.max(0, Math.min(1, motionScale))
    },
  }
}
