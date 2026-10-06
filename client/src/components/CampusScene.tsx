import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { PostCategory } from '../types/database';

interface CampusSceneProps {
  onExplore: (category: PostCategory | null, label: string) => void;
}

const campusStops: Record<string, { label: string; category: PostCategory | null; description: string }> = {
  Library: { label: '📚 Central Library', category: 'Spotted', description: 'Quiet study space & campus stories' },
  Canteen: { label: '🍜 Annapurna Canteen', category: 'Memes', description: 'Food, friends & everyday campus life' },
  Academic: { label: '🎓 Academic Block A', category: 'Confessions', description: 'Lectures, labs & student life' },
  Hostel: { label: '🏠 Aryabhatta Hostel', category: 'Rants', description: 'Hostel life & late-night stories' },
  Workshop: { label: '🔧 Workshop & ED Lab', category: 'Placements', description: 'Labs, projects & practical work' },
  Gate: { label: '🚪 Main Gate & Tapri', category: null, description: 'Arrivals, chai & campus conversations' },
  Ground: { label: '⚽ Sports Ground', category: 'Spotted', description: 'Games, sunsets & student life' },
};

function material(color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
}

export function CampusScene({ onExplore }: CampusSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipTitleRef = useRef<HTMLDivElement>(null);
  const tooltipDescriptionRef = useRef<HTMLDivElement>(null);
  const onExploreRef = useRef(onExplore);

  useEffect(() => { onExploreRef.current = onExplore; }, [onExplore]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const targetCanvas = canvas;
    const parent = targetCanvas.parentElement;
    if (!parent) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#e6eadf', 62, 145);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 180);
    camera.position.set(0, 15, 28);
    camera.lookAt(0, 1.3, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: targetCanvas, alpha: true, antialias: false, powerPreference: 'low-power' });
    } catch {
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1 : 1.25));

    const hemi = new THREE.HemisphereLight(0xffffff, 0xd8ccff, 0.95);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(12, 22, 10);
    scene.add(sun);

    const campus = new THREE.Group();
    scene.add(campus);
    const groundMaterial = material(0xffffff, { transparent: true, opacity: 0.42 });
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(16, 17, 2.4, 40), groundMaterial);
    ground.position.y = -1.2;
    campus.add(ground);
    const grassMaterial = material(0xe3f4e5, { transparent: true, opacity: 0.42 });
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(15.4, 15.4, 0.5, 40), grassMaterial);
    grass.position.y = 0.25;
    campus.add(grass);
    const roadMaterial = material(0xdcd4f5, { transparent: true, opacity: 0.64 });
    const eastRoad = new THREE.Mesh(new THREE.BoxGeometry(30, 0.14, 3.2), roadMaterial);
    eastRoad.position.y = 0.55;
    campus.add(eastRoad);
    const northRoad = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 30), roadMaterial);
    northRoad.position.y = 0.55;
    campus.add(northRoad);

    const buildings: THREE.Mesh[] = [];
    const makeBuilding = (name: string, x: number, z: number, w: number, h: number, d: number, wall: number, roof: number, pointed = false) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(wall));
      body.position.y = h / 2 + 0.5;
      body.userData.buildingName = name;
      group.add(body);
      buildings.push(body);
      const roofShape = pointed ? new THREE.ConeGeometry(Math.max(w, d) * 0.73, 1.5, 4) : new THREE.BoxGeometry(w + 0.45, 0.42, d + 0.45);
      const roofMesh = new THREE.Mesh(roofShape, material(roof));
      roofMesh.position.y = h + (pointed ? 1.25 : 0.75);
      if (pointed) roofMesh.rotation.y = Math.PI / 4;
      group.add(roofMesh);
      const windowMaterial = material(0xbfd4ff, { emissive: 0x8ea8ff, emissiveIntensity: 0.15, roughness: 0.35 });
      const columns = Math.max(2, Math.floor(w / 1.25));
      const windowRows = Math.max(1, Math.floor(h / 1.35));
      for (let row = 0; row < windowRows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.5), windowMaterial);
          windowMesh.position.set(-w / 2 + 0.65 + column * ((w - 1.1) / Math.max(1, columns - 1)), 0.5 + 0.8 + row * 1.1, d / 2 + 0.02);
          group.add(windowMesh);
        }
      }
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.15, 0.1), material(0x4c1d95));
      door.position.set(0, 1.08, d / 2 + 0.06);
      group.add(door);
      group.position.set(x, 0, z);
      campus.add(group);
    };

    makeBuilding('Library', -6.5, -5.5, 4.4, 4.6, 3.6, 0xc4b5fd, 0x6d28d9, true);
    makeBuilding('Canteen', 6.5, -5, 4.6, 2.4, 3.4, 0xfed7aa, 0xea580c);
    makeBuilding('Academic', -6.8, 5.5, 5.2, 3.4, 3.2, 0xa5b4fc, 0x4338ca);
    makeBuilding('Hostel', 6.8, 5.8, 3.4, 6.2, 3.2, 0x93c5fd, 0x0369a1, true);
    makeBuilding('Workshop', -1, 9.5, 4.4, 2.2, 2.6, 0xfcd34d, 0x92400e);
    makeBuilding('Ground', -10, 3.5, 2.4, 1.2, 2.4, 0x86efac, 0x15803d);
    makeBuilding('Gate', 0, -11.5, 5.5, 1.4, 1.2, 0xc4b5fd, 0x6d28d9);

    const treeLeaves = [0x86efac, 0x6ee7b7, 0xa7f3d0, 0xbbf7d0];
    const treeLocations: Array<[number, number]> = [[-10, -9], [10, -9], [-11, 0], [11, 1], [-10, 10], [10, 10], [-4, -9], [4, 9], [0, 7], [-9, 2], [9, -2], [-3, 3.5], [3, -3.5]];
    for (const [x, z] of treeLocations) {
      const scale = 0.8 + Math.random() * 0.5;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.24 * scale, 1.1 * scale), material(0x92400e));
      trunk.position.set(x, 1.05 * scale, z);
      campus.add(trunk);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95 * scale, 1), material(treeLeaves[Math.floor(Math.random() * treeLeaves.length)], { flatShading: true }));
      crown.position.set(x, 2.2 * scale, z);
      campus.add(crown);
    }

    const fountain = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.3, 0.7, 24), material(0xffffff));
    fountain.position.y = 0.9;
    campus.add(fountain);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.25, 24), material(0x7dd3fc, { transparent: true, opacity: 0.84, roughness: 0.2 }));
    water.position.y = 1.25;
    campus.add(water);
    const fountainTop = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 14), material(0xc4b5fd, { emissive: 0x7c3aed, emissiveIntensity: 0.3 }));
    fountainTop.position.y = 2.5;
    campus.add(fountainTop);

    const envelopes: Array<{ mesh: THREE.Mesh; angle: number; speed: number; offset: number }> = [];
    for (let index = 0; index < 4; index += 1) {
      const envelope = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.12), material(index % 2 ? 0xffffff : 0xfce7f3, { emissive: index % 2 ? 0xa78bfa : 0xec4899, emissiveIntensity: 0.24 }));
      const angle = (index / 4) * Math.PI * 2;
      const offset = Math.random() * 10;
      envelope.position.set(Math.cos(angle) * 9, 5 + Math.random() * 3, Math.sin(angle) * 9);
      campus.add(envelope);
      envelopes.push({ mesh: envelope, angle, speed: 0.3 + Math.random() * 0.4, offset });
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pointerStart = { x: 0, y: 0 };
    let dragging = false;
    let moved = false;
    let targetRotation = 0;
    let currentRotation = 0;
    let pointerX = 0;
    let clock = 0;
    let lastFrame = 0;
    let animationFrame = 0;
    let visible = true;
    let lastInteraction = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const hideTooltip = () => { if (tooltipRef.current) tooltipRef.current.style.opacity = '0'; };
    const resize = () => {
      const width = Math.max(1, parent.clientWidth);
      const height = Math.max(1, parent.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderOnce();
    };
    const draw = (now: number) => {
      animationFrame = 0;
      if (!visible || document.visibilityState === 'hidden') return;
      if (!reducedMotion && now - lastFrame < 33) { animationFrame = requestAnimationFrame(draw); return; }
      const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
      lastFrame = now;
      clock += delta;
      const autoSpin = !reducedMotion && now - lastInteraction > 2600;
      currentRotation += (targetRotation - currentRotation) * (1 - Math.exp(-4.5 * delta)) + (autoSpin ? delta * 0.07 : 0);
      campus.rotation.y = currentRotation;
      camera.position.x += (pointerX * 3 - camera.position.x) * 0.018;
      camera.lookAt(0, 1.25, 0);
      water.rotation.y = clock * 0.48;
      water.position.y = 1.25 + Math.sin(clock * 2) * 0.035;
      for (const envelope of envelopes) {
        envelope.angle += delta * envelope.speed;
        envelope.mesh.position.set(Math.cos(envelope.angle) * 9, 5.5 + Math.sin(clock * envelope.speed + envelope.offset) * 1.1, Math.sin(envelope.angle) * 9);
        envelope.mesh.rotation.y = clock * 0.7 + envelope.offset;
      }
      renderer.render(scene, camera);
      if (!reducedMotion) animationFrame = requestAnimationFrame(draw);
    };
    function renderOnce() {
      if (animationFrame || !visible) return;
      animationFrame = requestAnimationFrame(draw);
    }
    function pointerMove(event: PointerEvent) {
      const bounds = targetCanvas.getBoundingClientRect();
      pointerX = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      if (dragging) {
        const deltaX = event.clientX - pointerStart.x;
        if (Math.abs(deltaX) > 2) moved = true;
        targetRotation += deltaX * 0.008;
        pointerStart.x = event.clientX;
        lastInteraction = performance.now();
        hideTooltip();
        renderOnce();
        return;
      }
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(buildings, false)[0];
      const name = hit?.object.userData.buildingName as string | undefined;
      const stop = name ? campusStops[name] : null;
      const tooltip = tooltipRef.current;
      if (stop && tooltip && tooltipTitleRef.current && tooltipDescriptionRef.current) {
        tooltipTitleRef.current.textContent = stop.label;
        tooltipDescriptionRef.current.textContent = `${stop.description} · click to explore`;
        tooltip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - 255)}px`;
        tooltip.style.top = `${Math.min(event.clientY + 12, window.innerHeight - 90)}px`;
        tooltip.style.opacity = '1';
        targetCanvas.style.cursor = 'pointer';
      } else {
        hideTooltip();
        targetCanvas.style.cursor = 'grab';
      }
      lastInteraction = performance.now();
      renderOnce();
    }
    function pointerDown(event: PointerEvent) {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      dragging = true;
      moved = false;
      pointerStart.x = event.clientX;
      pointerStart.y = event.clientY;
      lastInteraction = performance.now();
      targetCanvas.setPointerCapture(event.pointerId);
      targetCanvas.style.cursor = 'grabbing';
    }
    function pointerUp(event: PointerEvent) {
      if (!dragging) return;
      dragging = false;
      if (targetCanvas.hasPointerCapture(event.pointerId)) targetCanvas.releasePointerCapture(event.pointerId);
      if (!moved) {
        const bounds = targetCanvas.getBoundingClientRect();
        pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const name = raycaster.intersectObjects(buildings, false)[0]?.object.userData.buildingName as string | undefined;
        const stop = name ? campusStops[name] : null;
        if (stop) onExploreRef.current(stop.category, stop.label);
      }
      targetCanvas.style.cursor = 'grab';
      renderOnce();
    }
    function visibilityChange() { if (document.visibilityState === 'visible') renderOnce(); else { lastFrame = 0; } }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);
    const intersectionObserver = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) renderOnce();
      else { cancelAnimationFrame(animationFrame); animationFrame = 0; lastFrame = 0; }
    }, { rootMargin: '100px' });
    intersectionObserver.observe(parent);
    targetCanvas.addEventListener('pointermove', pointerMove);
    targetCanvas.addEventListener('pointerdown', pointerDown);
    targetCanvas.addEventListener('pointerup', pointerUp);
    targetCanvas.addEventListener('pointercancel', pointerUp);
    document.addEventListener('visibilitychange', visibilityChange);
    resize();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      targetCanvas.removeEventListener('pointermove', pointerMove);
      targetCanvas.removeEventListener('pointerdown', pointerDown);
      targetCanvas.removeEventListener('pointerup', pointerUp);
      targetCanvas.removeEventListener('pointercancel', pointerUp);
      document.removeEventListener('visibilitychange', visibilityChange);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((item) => item.dispose());
        }
      });
      renderer.dispose();
    };
  }, []);

  return <>
    <div id="hero-3d" className="absolute inset-0 top-[68px]" aria-label="Interactive 3D Dumka Engineering College campus">
      <canvas ref={canvasRef} className="h-full w-full cursor-grab" aria-label="Drag to rotate the campus model; click a building to explore its posts" />
    </div>
    <div ref={tooltipRef} id="building-tip" className="glass border border-soft fixed z-[70] max-w-[240px] rounded-2xl px-4 py-3 soft pointer-events-none opacity-0" role="status">
      <div ref={tooltipTitleRef} className="font-grotesk text-sm font-bold" />
      <div ref={tooltipDescriptionRef} className="mt-0.5 text-xs text-muted" />
    </div>
  </>;
}
