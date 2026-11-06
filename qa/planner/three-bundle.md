# Rebuilding the 3D engine bundle

`vendor/three-0.187-xf.min.js` is one file, loaded only when someone opens the 3D view. Rebuild it only when upgrading Three.js. Run this in an empty folder outside the repository, and save the code below as `entry.js` first.

```
npm install three@0.187.0 esbuild@0.25.12
npx esbuild entry.js --bundle --minify --format=iife --global-name=XF3D --target=es2020 --legal-comments=none --outfile=three-xf.min.js
```

`entry.js`:

```js
export { WebGLRenderer, Scene, PerspectiveCamera, Color, Vector2, Vector3, Box3, Raycaster, Plane, Group, Mesh, LineSegments, LineLoop, Line, Sprite, BufferGeometry, BufferAttribute, Float32BufferAttribute,
  ExtrudeGeometry, ShapeGeometry, CylinderGeometry, SphereGeometry, PlaneGeometry, EdgesGeometry, Shape, Path, GridHelper, MeshStandardMaterial, MeshLambertMaterial, MeshBasicMaterial, LineBasicMaterial, SpriteMaterial,
  CanvasTexture, HemisphereLight, DirectionalLight, DoubleSide, SRGBColorSpace, TextureLoader, LoadingManager, REVISION } from "three";
export { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
export { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
```

Change the version in the file name when upgrading, so browsers fetch the new copy.
