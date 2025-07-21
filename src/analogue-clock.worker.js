import * as THREE from "three";
import { MathUtils } from "three";

class AnalogueClockRenderer {
  constructor() {
    this.options = {};

    this.sceneWidth = 1.1;
    this.sceneHeight = 1.1;
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
      markerColor: "#1C1C1C",
      fontFamily: '"Work Sans", "Trebuchet MS", sans-serif',
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

    await this._loadFont();
    this._createFace();
    this._createPinAndBezel();
    this._createHands();

    // Initial resize call to set everything up.
    this._onResize(initialWidth, initialHeight, this.pixelRatio);

    // Start animation
    this._animationLoop = this._animationLoop.bind(this);
    this.animationFrameId = self.requestAnimationFrame(this._animationLoop);
  }

  /**
   * Being a web worker, we don't have access to any fonts loaded in the main thread.
   * Hence, we need to explicitly load the web font.
   */
  async _loadFont() {
    const fontUrl =
      "https://fonts.gstatic.com/s/worksans/v23/QGY_z_wNahGAdqQ43RhVcIgYT2Xz5u32KxfXBi8Jpg.woff2";
    const fontFace = new FontFace("Work Sans", `url(${fontUrl})`);
    await fontFace.load();
    self.fonts.add(fontFace);
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

  _createTextSprite(
    text,
    { fontSize = 128, fontFamily = "sans-serif", color = "#000000" }
  ) {
    const canvas = new OffscreenCanvas(256, 256);
    const ctx = canvas.getContext("2d");

    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const yFudge = 10; // a tad lower please (for numerals especially)
    ctx.fillText(text, 128, 128 + yFudge);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    return sprite;
  }

  _createFace() {
    const radius = this.clockDiameter / 2;
    const faceGroup = new THREE.Group();
    this.scene.add(faceGroup);

    // Create the clock face
    const faceGeometry = new THREE.CircleGeometry(radius, 64);
    const faceMaterial = new THREE.MeshBasicMaterial({
      color: this.options.faceColor,
    });
    const faceMesh = new THREE.Mesh(faceGeometry, faceMaterial);
    faceMesh.receiveShadow = true;
    faceGroup.add(faceMesh);

    // Create markers
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: this.options.markerColor,
    });
    const markersGroup = new THREE.Group();
    markersGroup.position.z = 0.01; // Slightly in front of the face
    faceGroup.add(markersGroup);

    const markersRadius = radius * 0.88;

    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * Math.PI * 2;
      const isMajor = i % 5 === 0;

      let marker;
      if (isMajor) {
        const geometry = new THREE.CircleGeometry(radius * 0.01, 16);
        marker = new THREE.Mesh(geometry, markerMaterial);
        marker.position.x = Math.sin(angle) * markersRadius;
        marker.position.y = Math.cos(angle) * markersRadius;
      } else {
        const geometry = new THREE.PlaneGeometry(radius * 0.003, radius * 0.04);
        marker = new THREE.Mesh(geometry, markerMaterial);
        marker.position.x = Math.sin(angle) * markersRadius;
        marker.position.y = Math.cos(angle) * markersRadius;
        marker.rotation.z = -angle;
      }
      markersGroup.add(marker);
    }

    // Create numerals
    const numeralsGroup = new THREE.Group();
    numeralsGroup.position.z = 0.01;
    faceGroup.add(numeralsGroup);
    const numeralsRadius = markersRadius * 0.82;

    for (let h = 1; h <= 12; h++) {
      const angle = -(h / 12) * Math.PI * 2 + Math.PI / 2;
      const numeral = this._createTextSprite(h.toString(), {
        fontFamily: this.options.fontFamily,
        color: this.options.textColor,
        fontSize: 210,
      });

      numeral.position.x = Math.cos(angle) * numeralsRadius;
      numeral.position.y = Math.sin(angle) * numeralsRadius;
      numeral.scale.set(radius * 0.2, radius * 0.2, 1);
      numeralsGroup.add(numeral);
    }

    // Create brand text
    if (this.options.brand) {
      const increaseLetterSpacing = (text) => {
        // You can't set the letter spacing property, but you you can accomplish wider letter spacing
        // in canvas by inserting one of the various white spaces in between every letter in the string.
        // Credit: https://stackoverflow.com/a/14991381
        return text.split("").join(String.fromCharCode(8202));
      };
      const brandSprite = this._createTextSprite(
        increaseLetterSpacing(this.options.brand),
        {
          fontSize: 42,
          fontFamily: this.options.fontFamily,
          color: this.options.textColor,
        }
      );
      brandSprite.position.y = radius * 0.35;
      brandSprite.scale.set(radius * 0.25, radius * 0.25, 1);
      faceGroup.add(brandSprite);
    }
  }

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
