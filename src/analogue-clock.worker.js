import * as THREE from "three";
import { MathUtils } from "three";

class AnalogueClockRenderer {
  constructor() {
    this.options = {};

    this.sceneWidth = 1.1;
    this.sceneHeight = 1.1;
    this.clockDiameter = 1; // Includes bezel (this.faceDiameter will be set once we've created the bezel)

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
      faceColor: "#FFFFFF",
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

    this._createLighting(this.scene);

    await this._loadFont();
    this._createGoldMaterial();
    this._createPin();
    this._createBezel();
    // _createFace() depends on _createBezel() having been called to initialise this.faceDiameter
    this._createFace();
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

  _createGoldMaterial() {
    // TODO: replace with PBR gold material
    this.goldMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      metalness: 0.8,
      roughness: 0.2,
      side: THREE.DoubleSide, // TODO: Once we can see it, switch to single-sided
    });
  }

  /**
   * Helper method for use e.g. when creating curved sections of the profile for
   * a LatheGeometry. Generates an array of THREE.Vector2 points forming a
   * circular curve between a start and end point.
   *
   * @param {THREE.Vector2} startPoint - The starting point of the curve.
   * @param {THREE.Vector2} endPoint - The ending point of the curve.
   * @param {number} sweep - The sweep angle of the curve in radians (<= Math.PI).
   * @param {number} intermediatePointCount - The number of intermediate points.
   * @returns {Array<THREE.Vector2>} An array of points, including start and end.
   */
  _generateCurvePoints(startPoint, endPoint, sweep, intermediatePointCount) {
    const points = [];
    const chordLength = startPoint.distanceTo(endPoint);
    const nSegments = intermediatePointCount + 1;

    // Edge cases: straight line for zero distance or zero angle
    if (chordLength < 1e-6 || Math.abs(sweep) < 1e-6) {
      points.push(startPoint.clone());
      points.push(endPoint.clone());
      return points;
    }

    const radius = chordLength / (2 * Math.sin(sweep / 2));
    const h_center = Math.sqrt(
      Math.max(0, radius * radius - (chordLength / 2) * (chordLength / 2))
    );
    const midpoint = new THREE.Vector2()
      .addVectors(startPoint, endPoint)
      .multiplyScalar(0.5);
    const delta = new THREE.Vector2().subVectors(endPoint, startPoint);
    const perpDir = new THREE.Vector2(-delta.y, delta.x).normalize();

    const center = new THREE.Vector2().subVectors(
      midpoint,
      perpDir.clone().multiplyScalar(h_center)
    );

    const vec_C_to_S = new THREE.Vector2().subVectors(startPoint, center);
    const vec_C_to_E = new THREE.Vector2().subVectors(endPoint, center);

    // Determine the direction of rotation.
    let rotSign = Math.sign(vec_C_to_S.cross(vec_C_to_E));

    // Fallback for semi-circles (angle=PI) where vectors are collinear.
    if (rotSign === 0) {
      rotSign = -Math.sign(perpDir.cross(vec_C_to_S));
    }

    const angleIncrement = (rotSign * sweep) / nSegments;

    points.push(startPoint.clone());
    for (let i = 1; i <= intermediatePointCount; i++) {
      const currentAngle = i * angleIncrement;
      const pointOnCircle = vec_C_to_S
        .clone()
        .rotateAround(new THREE.Vector2(0, 0), currentAngle);
      points.push(pointOnCircle.add(center));
    }
    points.push(endPoint.clone());

    return points;
  }

  _createPin() {
    const pinRadius = this.clockDiameter / 100;
    const pinHoleRadius = pinRadius / 4;
    const pinH1 = this.clockDiameter / 28;
    const pinH2 = pinH1 + pinRadius / 3;

    const points = [];

    // Pin start
    points.push(new THREE.Vector2(pinHoleRadius, pinH1));
    points.push(new THREE.Vector2(pinHoleRadius, pinH2));
    // Pin's outer edge is small curved bevel
    points.push(
      ...this._generateCurvePoints(
        new THREE.Vector2(pinRadius, pinH2),
        new THREE.Vector2(pinRadius + pinH2 - pinH1, pinH1),
        Math.PI / 2,
        4
      )
    );
    // Terminate the pin with a point with y=0
    points.push(new THREE.Vector2(pinRadius + pinH2 - pinH1, 0));

    const geometry = new THREE.LatheGeometry(points, 48);
    const pin = new THREE.Mesh(geometry, this.goldMaterial);

    // The lathe creates geometry along the Y axis. Rotate so it points toward the camera.
    pin.rotation.x = Math.PI / 2;

    this.scene.add(pin);
  }

  _createBezel() {
    const bezelDiagW = this.clockDiameter / 80;
    const bezelDiagH = bezelDiagW * 2;
    const bezelCurveW = bezelDiagW * 2;
    const curveSegments = 12;

    this.faceDiameter = this.clockDiameter - (bezelDiagW + bezelCurveW) * 2;
    const faceRadius = this.faceDiameter / 2;

    const points = [];

    // Bezel starts with a diagonal up from y=0 and terminates with a curve down to y=0
    points.push(new THREE.Vector2(faceRadius, 0));
    points.push(
      ...this._generateCurvePoints(
        new THREE.Vector2(faceRadius + bezelDiagW, bezelDiagH),
        new THREE.Vector2(this.clockDiameter / 2, 0),
        Math.PI,
        curveSegments
      )
    );

    const geometry = new THREE.LatheGeometry(points, 96);
    const bezel = new THREE.Mesh(geometry, this.goldMaterial);

    // The lathe creates geometry along the Y axis. Rotate so it points toward the camera.
    bezel.rotation.x = Math.PI / 2;

    this.scene.add(bezel);
  }

  _createFace() {
    if (!this.faceDiameter)
      throw new Error("this.faceDiameter not initialised");
    const radius = this.faceDiameter / 2;
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
