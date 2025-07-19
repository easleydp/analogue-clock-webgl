import * as THREE from "three";
import { MathUtils } from "three";

class AnalogueClockRenderer {
  constructor() {
    this.options = {};

    this.clockDiameter = 1;

    this.isRunning = false;
    this.animationFrameId = null;
    this.lastTimestamp = -1; // Last timestamp for animation loop
    this.maxRateHz = 50;
    this.lastRateHz = this.maxRateHz;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
  }

  async init(canvas, options, initialWidth, initialHeight, pixelRatio) {
    this.pixelRatio = pixelRatio;
    // TODO: review these options (are they all actually used?)
    this.options = {
      textColor: "#1C1C1C",
      fontFamily: "Arial, sans-serif",
      faceColor: "#F5F5DC",
      secondHandColor: "rgb(255, 40, 40)",
      minuteHandColor: "#1C1C1C",
      hourHandColor: "#1C1C1C",
      romanNumerals: false,
      brand: null, // e.g. "Acme". Displayed as static text on the clock face, half way between the centre pin and the '12'.
      ...options,
    };

    if (this.isRunning) return;
    this.isRunning = true;

    this.scene = new THREE.Scene();
    this.scene.visible = false; // Wait until all the textLines are initialised

    // ## Camera Setup ##
    // The initial camera setup. The aspect ratio and fov will be adjusted
    // dynamically by the ResizeObserver.
    const aspect = initialWidth / initialHeight;
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    // The generated cylinder is quite large, so we need to move the camera
    // back to be able to see it.
    this.camera.position.z = 30;

    // ## Renderer Setup ##
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // renderer size set in onResize

    // ## Lighting ##
    this._createLighting(this.scene);

    this._createFace();
    this._createPinAndBezel();
    this._createHands();

    // Initial resize call to set everything up.
    this._onResize(initialWidth, initialHeight, this.pixelRatio);

    // Start animation
    this._animationLoop = this._animationLoop.bind(this);
    this.animationFrameId = self.requestAnimationFrame(this._animationLoop);
  }

  _createLighting(scene) {
    const ambientLight = new THREE.AmbientLight(0x404040, 0.3);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    // Add a rim light for better gold appearance
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    rimLight.position.set(-5, 2, -5);
    scene.add(rimLight);
  }

  _createFace() {}
  _createPinAndBezel() {}
  _createHands() {}

  _onResize(width, height, pixelRatio) {
    this.pixelRatio = pixelRatio;
    if (!this.isRunning || !this.renderer || !this.camera) {
      return;
    }

    // ## Maintain Camera Perspective ##

    // To ensure the rendered view is simply a magnified version of a smaller view,
    // we need to make sure that the visible area of the scene at a given distance
    // from the camera remains constant. In Three.js, the PerspectiveCamera's
    // vertical field of view (fov) and the canvas's aspect ratio determine what
    // is visible.
    // So we need to adjust the fov based on the canvas height.

    // The desired visible height of the scene at the camera's z-position.
    let visibleHeight = this.sceneHeight;
    const ctAspectRatio = width / height;
    const sceneAspectRatio = this.sceneWidth / this.sceneHeight;
    if (ctAspectRatio < sceneAspectRatio) {
      visibleHeight *= sceneAspectRatio / ctAspectRatio;
    }

    const fov = 2 * Math.atan(visibleHeight / (2 * this.camera.position.z));
    this.camera.fov = MathUtils.radToDeg(fov);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix(); // crucial after changing camera parameters!

    // ## Optimal Detail ##
    this.renderer.setSize(
      Math.floor(width * this.pixelRatio),
      Math.floor(height * this.pixelRatio),
      false
    );
  }

  _animationLoop(timestamp) {
    if (!this.isRunning) return;

    // Throttle animation loop to spare the battery
    const delta = timestamp - this.lastTimestamp;
    const actualRateHz = Math.round(1000 / delta);
    if (actualRateHz < this.maxRateHz) {
      // // Show actual refresh rate in console
      // if (this.lastTimestamp !== -1 && actualRateHz !== this.lastRateHz)
      //   console.log(`Refresh rate: ${actualRateHz} Hz`);
      this.lastRateHz = actualRateHz;
      this.lastTimestamp = timestamp;

      // ## Animation ##
      // TODO: animate the clock hands

      if (this.renderer) this.renderer.render(this.scene, this.camera);
    }

    this.animationFrameId = self.requestAnimationFrame(this._animationLoop);
  }

  destroy() {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.animationFrameId) {
      self.cancelAnimationFrame(this.animationFrameId);
    }

    if (this.scene) {
      this.scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => {
              if (material.map) material.map.dispose();
              material.dispose();
            });
          } else {
            if (object.material.map) object.material.map.dispose();
            object.material.dispose();
          }
        }
      });
      this.scene.clear();
    }

    for (const tex of Object.values(this.textures || {})) {
      if (tex) tex.dispose();
    }

    this.font = null;

    if (this.renderer) {
      this.renderer.dispose();
    }

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.options = null;
  }
}

const renderer = new AnalogueClockRenderer();

self.onmessage = function (e) {
  const { type, payload } = e.data;

  switch (type) {
    case "init":
      renderer
        .init(
          payload.canvas,
          payload.options,
          payload.width,
          payload.height,
          payload.pixelRatio
        )
        .catch((err) =>
          console.error("Error initializing renderer in worker:", err)
        );
      break;
    case "resize":
      renderer._onResize(payload.width, payload.height, payload.pixelRatio);
      break;
    case "destroy":
      renderer.destroy();
      self.close();
      break;
  }
};
