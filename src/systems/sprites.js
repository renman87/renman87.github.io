/* global AFRAME THREE */

import spritesheet from "../assets/images/hud/spritesheet.json";
import { createImageTexture } from "../utils/media-utils";
import spritesheetPng from "../assets/images/hud/spritesheet.png";
import { waitForDOMContentLoaded } from "../utils/async-utils";
import vert from "./sprites/sprite.vert";
import frag from "./sprites/sprite.frag";

function isVisible(o) {
  if (!o.visible) return false;
  if (!o.parent) return true;
  return isVisible(o.parent);
}

AFRAME.registerComponent("sprite", {
  schema: { name: { type: "string" } },
  tick() {
    if (!this.didRegisterWithSystem && this.el.sceneEl.systems["post-physics"]) {
      this.didRegisterWithSystem = this.el.sceneEl.systems["post-physics"].spriteSystem.add(this);
    }
  },
  remove() {
    if (this.didRegisterWithSystem) {
      this.el.sceneEl.systems["post-physics"].spriteSystem.remove(this);
    }
  }
});

const normalizedFrame = (function() {
  const memo = new Map();
  return function normalizedFrame(name, spritesheet, missingSprites) {
    let ret = memo.get(name);
    if (ret) {
      return ret;
    } else {
      if (!spritesheet.frames[name]) {
        if (missingSprites.indexOf(name) === -1) {
          missingSprites.push(name);
        }
        ret = { x: 0, y: 0, w: 0, h: 0 };
        memo.set(name, ret);
        return ret;
      }
      const size = spritesheet.meta.size;
      const frame = spritesheet.frames[name].frame;
      ret = {
        x: frame.x / size.w,
        y: frame.y / size.h,
        w: frame.w / size.w,
        h: frame.h / size.h
      };
      memo.set(name, ret);
      return ret;
    }
  };
})();

const raycastOnSprite = (function() {
  const intersectPoint = new THREE.Vector3();
  const worldScale = new THREE.Vector3();
  const mvPosition = new THREE.Vector3();

  const alignedPosition = new THREE.Vector2();
  const viewWorldMatrix = new THREE.Matrix4();

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();

  const uvA = new THREE.Vector2();
  const uvB = new THREE.Vector2();
  const uvC = new THREE.Vector2();

  const CENTER = new THREE.Vector2(0.5, 0.5);

  function transformVertex(vertexPosition, mvPosition, center, scale) {
    // compute position in camera space
    alignedPosition
      .subVectors(vertexPosition, center)
      .addScalar(0.5)
      .multiply(scale);

    vertexPosition.copy(mvPosition);
    vertexPosition.x += alignedPosition.x;
    vertexPosition.y += alignedPosition.y;

    // transform to world space
    vertexPosition.applyMatrix4(viewWorldMatrix);
  }

  return function raycast(raycaster, intersects) {
    worldScale.setFromMatrixScale(this.matrixWorld);
    this.modelViewMatrix.multiplyMatrices(AFRAME.scenes[0].camera.matrixWorldInverse, this.matrixWorld);
    viewWorldMatrix.getInverse(this.modelViewMatrix).premultiply(this.matrixWorld);
    mvPosition.setFromMatrixPosition(this.modelViewMatrix);

    transformVertex(vA.set(-0.5, 0.5, 0), mvPosition, CENTER, worldScale);
    transformVertex(vB.set(0.5, 0.5, 0), mvPosition, CENTER, worldScale);
    transformVertex(vC.set(-0.5, -0.5, 0), mvPosition, CENTER, worldScale);

    uvA.set(0, 0);
    uvB.set(1, 0);
    uvC.set(1, 1);

    // check first triangle
    let intersect = raycaster.ray.intersectTriangle(vA, vC, vB, false, intersectPoint);

    if (intersect === null) {
      // check second triangle
      transformVertex(vA.set(0.5, -0.5, 0), mvPosition, CENTER, worldScale);
      uvA.set(0, 1);

      intersect = raycaster.ray.intersectTriangle(vB, vC, vA, false, intersectPoint);
      if (intersect === null) {
        return;
      }
    }

    const distance = raycaster.ray.origin.distanceTo(intersectPoint);

    if (distance < raycaster.near || distance > raycaster.far) return;

    intersects.push({
      distance: distance,
      point: intersectPoint.clone(),
      uv: THREE.Triangle.getUV(intersectPoint, vA, vB, vC, uvA, uvB, uvC, new THREE.Vector2()),
      face: null,
      object: this
    });
  };
})();

function getHoverableVisuals(el) {
  if (!el || !el.components) return null;
  if (el.components["hoverable-visuals"]) {
    return el.components["hoverable-visuals"];
  }
  return getHoverableVisuals(el.parentEl);
}

function enableSweepingEffect(comp) {
  const hoverableVisuals = getHoverableVisuals(comp.el);
  if (!hoverableVisuals) {
    return false;
  }

  const isPinned = hoverableVisuals.el.components.pinnable && hoverableVisuals.el.components.pinnable.data.pinned;
  const isSpawner = !!hoverableVisuals.el.components["super-spawner"];
  const isFrozen = hoverableVisuals.el.sceneEl.is("frozen");
  const hideDueToPinning = !isSpawner && isPinned && !isFrozen;
  return hoverableVisuals.data.enableSweepingEffect && !hideDueToPinning;
}

function createGeometry(maxSprites) {
  const geometry = new THREE.BufferGeometry();
  geometry.addAttribute("a_vertices", new THREE.BufferAttribute(new Float32Array(maxSprites * 3 * 4), 3, false));
  geometry.addAttribute(
    "a_hubs_EnableSweepingEffect",
    new THREE.BufferAttribute(new Float32Array(maxSprites * 4), 1, false)
  );
  geometry.addAttribute(
    "a_hubs_SweepParams",
    new THREE.BufferAttribute(new Float32Array(maxSprites * 4 * 2), 2, false)
  );
  geometry.addAttribute("a_uvs", new THREE.BufferAttribute(new Float32Array(maxSprites * 2 * 4), 2, false));
  const mvCols = new THREE.InterleavedBuffer(new Float32Array(maxSprites * 16 * 4), 16);
  geometry.addAttribute("mvCol0", new THREE.InterleavedBufferAttribute(mvCols, 4, 0, false));
  geometry.addAttribute("mvCol1", new THREE.InterleavedBufferAttribute(mvCols, 4, 4, false));
  geometry.addAttribute("mvCol2", new THREE.InterleavedBufferAttribute(mvCols, 4, 8, false));
  geometry.addAttribute("mvCol3", new THREE.InterleavedBufferAttribute(mvCols, 4, 12, false));
  const indices = new Array(3 * 2 * maxSprites);
  for (let i = 0; i < maxSprites; i++) {
    indices[i * 3 * 2 + 0] = i * 4 + 0;
    indices[i * 3 * 2 + 1] = i * 4 + 2;
    indices[i * 3 * 2 + 2] = i * 4 + 1;
    indices[i * 3 * 2 + 3] = i * 4 + 1;
    indices[i * 3 * 2 + 4] = i * 4 + 2;
    indices[i * 3 * 2 + 5] = i * 4 + 3;
  }
  geometry.setIndex(indices);
  return geometry;
}

export class SpriteSystem {
  raycast(raycaster, intersects) {
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]) continue;

      const o = this.indexWithSprite.get(i).el.object3D;
      if (isVisible(o)) {
        raycastOnSprite.call(o, raycaster, intersects);
      }
    }
    return intersects;
  }
  constructor(scene) {
    this.missingSprites = [];
    this.maxSprites = 512;
    this.slots = new Array(this.maxSprites);
    this.spriteWithIndex = new Map();
    this.indexWithSprite = new Map();
    this.stack = new Array(this.maxSprites);
    for (let i = 0; i < this.maxSprites; i++) {
      this.stack[i] = this.maxSprites - 1 - i;
    }

    Promise.all([createImageTexture(spritesheetPng), waitForDOMContentLoaded()]).then(([spritesheetTexture]) => {
      const material = new THREE.RawShaderMaterial({
        uniforms: {
          u_spritesheet: { value: spritesheetTexture },
          hubs_Time: { value: 0 }
        },
        vertexShader: vert,
        fragmentShader: frag,
        side: THREE.DoubleSide,
        transparent: true
      });
      this.mesh = new THREE.Mesh(createGeometry(this.maxSprites), material);
      const el = document.createElement("a-entity");
      el.classList.add("ui");
      scene.appendChild(el);
      el.setObject3D("mesh", this.mesh);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = window.APP.RENDER_ORDER.HUD_ICONS;
      this.mesh.raycast = this.raycast.bind(this);
    });
  }

  tick(t) {
    if (!this.mesh) return;

    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]) continue;

      const component = this.indexWithSprite.get(i);
      this.set(component, i);
    }

    this.mesh.material.uniforms.hubs_Time.value = t;
    this.mesh.material.uniformsNeedUpdate = true;
  }

  set(spriteComp, i) {
    if (isVisible(spriteComp.el.object3D)) {
      spriteComp.el.object3D.updateMatrices();
      const aEnableSweepingEffect = this.mesh.geometry.attributes["a_hubs_EnableSweepingEffect"];
      const enableSweepingEffectValue = enableSweepingEffect(spriteComp) ? 1 : 0;
      aEnableSweepingEffect.array[i * 4 + 0] = enableSweepingEffectValue;
      aEnableSweepingEffect.array[i * 4 + 1] = enableSweepingEffectValue;
      aEnableSweepingEffect.array[i * 4 + 2] = enableSweepingEffectValue;
      aEnableSweepingEffect.array[i * 4 + 3] = enableSweepingEffectValue;
      aEnableSweepingEffect.needsUpdate = true;
      if (enableSweepingEffectValue) {
        const hoverableVisuals = getHoverableVisuals(spriteComp.el);
        const aSweepParams = this.mesh.geometry.attributes["a_hubs_SweepParams"];
        const s = hoverableVisuals.sweepParams[0];
        const t = hoverableVisuals.sweepParams[1];
        aSweepParams.setXY(4 * i + 0, s, t);
        aSweepParams.setXY(4 * i + 1, s, t);
        aSweepParams.setXY(4 * i + 2, s, t);
        aSweepParams.setXY(4 * i + 3, s, t);
        aSweepParams.needsUpdate = true;
      }

      const mvCols = this.mesh.geometry.attributes["mvCol0"].data; // interleaved
      const mat4 = spriteComp.el.object3D.matrixWorld;
      mvCols.array.set(mat4.elements, i * 4 * 16 + 0);
      mvCols.array.set(mat4.elements, i * 4 * 16 + 1 * 16);
      mvCols.array.set(mat4.elements, i * 4 * 16 + 2 * 16);
      mvCols.array.set(mat4.elements, i * 4 * 16 + 3 * 16);
      mvCols.needsUpdate = true;

      // TODO: modify the matrix scale instead
      const aVertices = this.mesh.geometry.attributes["a_vertices"];
      aVertices.setXYZ(i * 4 + 0, -0.5, 0.5, 0);
      aVertices.setXYZ(i * 4 + 1, 0.5, 0.5, 0);
      aVertices.setXYZ(i * 4 + 2, -0.5, -0.5, 0);
      aVertices.setXYZ(i * 4 + 3, 0.5, -0.5, 0);
      aVertices.needsUpdate = true;
    } else {
      // TODO: modify the matrix scale instead
      const aVertices = this.mesh.geometry.attributes["a_vertices"];
      aVertices.setXYZ(i * 4 + 0, 0, 0, 0);
      aVertices.setXYZ(i * 4 + 1, 0, 0, 0);
      aVertices.setXYZ(i * 4 + 2, 0, 0, 0);
      aVertices.setXYZ(i * 4 + 3, 0, 0, 0);
      aVertices.needsUpdate = true;
    }
  }

  add(sprite) {
    if (!this.mesh) {
      return false;
    }
    const i = this.stack.pop();
    if (i === undefined) {
      console.error("Too many sprites");
      return false;
    }
    this.slots[i] = true;
    this.spriteWithIndex.set(sprite, i);
    this.indexWithSprite.set(i, sprite);

    const frame = normalizedFrame(sprite.data.name, spritesheet, this.missingSprites);
    const aUvs = this.mesh.geometry.attributes["a_uvs"];
    aUvs.setXY(i * 4 + 0, frame.x, frame.y);
    aUvs.setXY(i * 4 + 1, frame.x + frame.w, frame.y);
    aUvs.setXY(i * 4 + 2, frame.x, frame.y + frame.h);
    aUvs.setXY(i * 4 + 3, frame.x + frame.w, frame.y + frame.h);
    aUvs.needsUpdate = true;

    const aVertices = this.mesh.geometry.attributes["a_vertices"];
    aVertices.setXYZ(i * 4 + 0, -0.5, 0.5, 0);
    aVertices.setXYZ(i * 4 + 1, 0.5, 0.5, 0);
    aVertices.setXYZ(i * 4 + 2, -0.5, -0.5, 0);
    aVertices.setXYZ(i * 4 + 3, 0.5, -0.5, 0);
    aVertices.needsUpdate = true;
    return true;
  }

  remove(sprite) {
    const i = this.spriteWithIndex.get(sprite);
    this.spriteWithIndex.delete(sprite);
    this.indexWithSprite.delete(i);
    this.slots[i] = false;
    this.stack.push(i);

    //TODO: modify the matrix scale instead.
    const aVertices = this.mesh.geometry.attributes["a_vertices"];
    aVertices.setXYZ(i * 4 + 0, 0, 0, 0);
    aVertices.setXYZ(i * 4 + 1, 0, 0, 0);
    aVertices.setXYZ(i * 4 + 2, 0, 0, 0);
    aVertices.setXYZ(i * 4 + 3, 0, 0, 0);
    aVertices.needsUpdate = true;
  }
}