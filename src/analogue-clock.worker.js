import * as THREE from "three";
import { MathUtils } from "three";

class AnalogueClockRenderer {
  constructor() {
    this.options = {};

    this.sceneWidth = 1.1;
    this.sceneHeight = 1.1;
    this.clockRadius = 0.5; // Includes bezel (this.faceRadius will be set once we've created the bezel)

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
    // _createFace() depends on _createBezel() having been called to initialise this.faceRadius
    this._createFace();
    // _createHands() depends on _createPin() having been called to initialise this.pinRadius
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
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
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
      side: THREE.BackSide,
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
    const pinRadius = this.clockRadius / 40;
    const pinHoleRadius = pinRadius / 6;
    const pinH1 = this.clockRadius / 14;
    const pinH2 = pinH1 + pinRadius / 3;

    this.pinRadius = pinRadius;

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
    points.push(new THREE.Vector2(pinRadius + pinH2 - pinH1, pinH1));

    const geometry = new THREE.LatheGeometry(points, 48);
    const pin = new THREE.Mesh(geometry, this.goldMaterial);

    // The lathe creates geometry along the Y axis. Rotate so it points toward the camera.
    pin.rotation.x = Math.PI / 2;

    this.scene.add(pin);
  }

  _createBezel() {
    const bezelDiagW = this.clockRadius / 40;
    const bezelDiagH = bezelDiagW * 2;
    const bezelCurveW = bezelDiagW * 2;
    const curveSegments = 12;

    this.faceRadius = this.clockRadius - (bezelDiagW + bezelCurveW);

    const points = [];

    // Bezel starts with a diagonal up from y=0 and terminates with a curve down to y=0
    points.push(new THREE.Vector2(this.faceRadius, 0));
    points.push(
      ...this._generateCurvePoints(
        new THREE.Vector2(this.faceRadius + bezelDiagW, bezelDiagH),
        new THREE.Vector2(this.clockRadius, 0),
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
    if (!this.faceRadius) throw new Error("this.faceRadius not initialised");
    const radius = this.faceRadius;
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

  _createHands() {
    const handsGroup = new THREE.Group();
    handsGroup.position.setZ(0.01); // TODO: define in terms of pin start height
    this.scene.add(handsGroup);

    const minuteAndHourMaterial = new THREE.MeshStandardMaterial({
      color: 0x777777,
      metalness: 0.8,
      roughness: 0.2,
    });

    const minuteHandLen = this.faceRadius * 0.8;
    const minuteHandGeom = this._createHourOrMinuteHandGeom(
      minuteHandLen,
      minuteHandLen / 29,
      minuteHandLen / 15
    );

    this.minuteHand = new THREE.Mesh(minuteHandGeom, minuteAndHourMaterial);
    handsGroup.add(this.minuteHand);

    const hourHandLen = this.faceRadius * 0.54;
    const hourHandGeom = this._createHourOrMinuteHandGeom(
      hourHandLen,
      hourHandLen / 29,
      hourHandLen / 9
    );

    this.hourHand = new THREE.Mesh(hourHandGeom, minuteAndHourMaterial);
    this.hourHand.rotation.z = -Math.PI / 2;

    handsGroup.add(this.hourHand);
  }

  // ChatGPT version:
  // /**
  //  * Helper method for creating a `THREE.ShapeGeometry` for an individual clock hand.
  //  *
  //  * @param {number} length - Length of the hand.
  //  * @param {number} rootWidth - Width of the hand at the root.
  //  * @param {number} maxWidth - The maximum width of the hand.
  //  * @returns {THREE.ShapeGeometry} A clock hand starting at [0, 0] and pointing upwards.
  //  */
  // _createHourOrMinuteHandGeom(length, rootWidth, maxWidth) {
  //   const shape = new THREE.Shape();

  //   const lowerLen = 0.27 * length;
  //   const midLen = 0.33 * length;
  //   const upperLen = 0.4 * length;

  //   const y0 = 0;
  //   const y1 = lowerLen;
  //   const y2 = y1 + midLen;
  //   const y3 = y2 + upperLen;

  //   const tipRadius = rootWidth * 0.125;

  //   /**
  //    * Helper to draw one side (left or right) of the hand.
  //    * @param {1|-1} dir Direction multiplier for x-axis (1 for right, -1 for left).
  //    * @param {boolean} reverse Whether to reverse the curve order (left side).
  //    * @returns {THREE.CurvePath} The path of that side.
  //    */
  //   function drawSide(dir, reverse = false) {
  //     const points = [];

  //     // Root to lower concave curve
  //     points.push([
  //       (dir * rootWidth) / 2,
  //       y0,
  //       (dir * rootWidth) / 2,
  //       y0 + lowerLen * 0.3,
  //       (dir * maxWidth) / 2,
  //       y0 + lowerLen * 0.7,
  //       (dir * maxWidth) / 2,
  //       y1,
  //     ]);

  //     // Convex bulge
  //     points.push([
  //       (dir * maxWidth) / 2,
  //       y1 + midLen * 0.3,
  //       (dir * maxWidth) / 2,
  //       y1 + midLen * 0.7,
  //       ((dir * maxWidth) / 2) * 0.9,
  //       y2,
  //     ]);

  //     // Upper concave to tip
  //     points.push([
  //       ((dir * maxWidth) / 2) * 0.75,
  //       y2 + upperLen * 0.3,
  //       dir * tipRadius,
  //       y2 + upperLen * 0.7,
  //       dir * tipRadius,
  //       y3 - tipRadius,
  //     ]);

  //     // Apply all curves
  //     for (let segment of reverse ? points.reverse() : points) {
  //       shape.bezierCurveTo(...segment);
  //     }
  //   }

  //   // Start at bottom-right
  //   shape.moveTo(rootWidth / 2, y0);

  //   // Right side (normal order)
  //   drawSide(1, false);

  //   // Semi-circular blunt tip
  //   shape.absarc(0, y3 - tipRadius, tipRadius, 0, Math.PI, false);

  //   // Left side (mirror, reverse order)
  //   drawSide(-1, true);

  //   shape.lineTo(rootWidth / 2, y0); // Close the shape

  //   return new THREE.ShapeGeometry(shape);
  // }

  // Claude version:
  // /**
  //  * Helper method for creating a `THREE.ShapeGeometry` for an individual clock hand.
  //  *
  //  * @param {number} length - length of the hand.
  //  * @param {number} rootWidth - width of the hand at the root.
  //  * @param {number} maxWidth - the maximum width of the hand.
  //  * @returns {THREE.ShapeGeometry} A clock hand starting at [0, 0] and pointing upwards.
  //  */
  // _createHourOrMinuteHandGeom(length, rootWidth, maxWidth) {
  //   const shape = new THREE.Shape();

  //   // Key measurements
  //   const halfRootWidth = rootWidth / 2;
  //   const halfMaxWidth = maxWidth / 2;
  //   const tipRadius = rootWidth * 0.125; // Semi-circle radius (25% of rootWidth / 2)

  //   // Vertical positions for the three curved sections
  //   const bulgeY = length * 0.4; // Convex bulge at 40% height
  //   const lowerCurveStart = 0; // Root (27% section below bulge)
  //   const upperCurveEnd = length - tipRadius; // End before tip (40% section above bulge)

  //   // Calculate control points for curves (for right side)
  //   const lowerCurveControl1X =
  //     halfRootWidth + (halfMaxWidth - halfRootWidth) * 0.3;
  //   const lowerCurveControl1Y = length * 0.1;
  //   const lowerCurveControl2X =
  //     halfMaxWidth - (halfMaxWidth - halfRootWidth) * 0.2;
  //   const lowerCurveControl2Y = bulgeY - length * 0.08;

  //   const upperCurveControl1X =
  //     halfMaxWidth + (halfMaxWidth - halfRootWidth) * 0.1;
  //   const upperCurveControl1Y = bulgeY + length * 0.15;
  //   const upperCurveControl2X = tipRadius + tipRadius * 0.4;
  //   const upperCurveControl2Y = upperCurveEnd - length * 0.05;

  //   /**
  //    * Adds bezier curves for one side of the hand
  //    * @param {number} sign - 1 for right side, -1 for left side
  //    */
  //   function addHandSide(sign) {
  //     // Lower concave curve (root to bulge) - subtle curve
  //     shape.bezierCurveTo(
  //       sign * lowerCurveControl1X,
  //       lowerCurveControl1Y,
  //       sign * lowerCurveControl2X,
  //       lowerCurveControl2Y,
  //       sign * halfMaxWidth,
  //       bulgeY
  //     );

  //     // Upper concave curve (bulge to tip) - more pronounced curve
  //     shape.bezierCurveTo(
  //       sign * upperCurveControl1X,
  //       upperCurveControl1Y,
  //       sign * upperCurveControl2X,
  //       upperCurveControl2Y,
  //       sign * tipRadius,
  //       upperCurveEnd
  //     );
  //   }

  //   // Start at the root center-right
  //   shape.moveTo(halfRootWidth, lowerCurveStart);

  //   // Right side
  //   addHandSide(1);

  //   // Tip: Semi-circular end
  //   shape.absarc(0, upperCurveEnd, tipRadius, 0, Math.PI, false);

  //   // Left side (mirrored)
  //   addHandSide(-1);

  //   // Close the shape back to the starting point
  //   shape.lineTo(halfRootWidth, lowerCurveStart);

  //   return new THREE.ShapeGeometry(shape);
  // }

  // Gemini version:
  /**
   * Helper method for creating a `THREE.ShapeGeometry` for an hour or minute hand.
   *
   * The generated hand shape is symmetrical about the y-axis and points upwards,
   * with its root at the origin [0, 0]. It features a curvaceous design with a
   * convex bulge and a blunt, semi-circular tip. The shape's proportions and
   * curviness can be easily adjusted via constants within the function.
   *
   * @param {number} length - The total length of the hand from the center root to the tip.
   * @param {number} rootWidth - The width of the hand at its base (root).
   * @param {number} maxWidth - The maximum width of the hand at its widest point (the bulge).
   * @returns {THREE.ShapeGeometry} A clock hand geometry.
   */
  _createHourOrMinuteHandGeom(length, rootWidth, maxWidth) {
    // --- Tweakable Parameters for Hand Shape ---
    const BULGE_Y_FRAC = 0.4;
    const TIP_DIAMETER_FRAC = 0.2;
    const CP1_Y_FRAC = 0.1;
    const CP1_X_FACTOR = 0.7;
    const CP2_Y_FRAC = 0.3;
    const CP2_X_FACTOR = 1.1;
    const CP4_Y_INTERPOLATE = 0.75;

    // --- Define the Right-Side Profile ---
    // All points for one half of the hand are calculated here.
    const shape = new THREE.Shape();

    const r_half = rootWidth / 2;
    const m_half = maxWidth / 2;
    const tipRadius = (rootWidth * TIP_DIAMETER_FRAC) / 2;

    const bulgeY = length * BULGE_Y_FRAC;
    const tipArcY = length - tipRadius;

    const pRootR = { x: r_half, y: 0 };
    const pBulgeR = { x: m_half, y: bulgeY };
    const pTipSideR = { x: tipRadius, y: tipArcY };

    const cp1 = { x: pRootR.x * CP1_X_FACTOR, y: length * CP1_Y_FRAC };
    const cp2 = { x: pBulgeR.x * CP2_X_FACTOR, y: length * CP2_Y_FRAC };
    const cp3 = { x: 2 * pBulgeR.x - cp2.x, y: 2 * pBulgeR.y - cp2.y };
    const cp4 = {
      x: pTipSideR.x,
      y: pBulgeR.y + (pTipSideR.y - pBulgeR.y) * CP4_Y_INTERPOLATE,
    };

    // --- Draw Right Side Path ---
    shape.moveTo(pRootR.x, pRootR.y);
    shape.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, pBulgeR.x, pBulgeR.y);
    shape.bezierCurveTo(cp3.x, cp3.y, cp4.x, cp4.y, pTipSideR.x, pTipSideR.y);

    // --- Draw Tip Arc ---
    shape.absarc(0, tipArcY, tipRadius, 0, Math.PI, false);

    // --- Draw Left Side Path by Reusing and Mirroring Right-Side Points ---
    // This approach guarantees symmetry. The path is drawn from the tip down to the root.
    shape.bezierCurveTo(-cp4.x, cp4.y, -cp3.x, cp3.y, -pBulgeR.x, pBulgeR.y);
    shape.bezierCurveTo(-cp2.x, cp2.y, -cp1.x, cp1.y, -pRootR.x, pRootR.y);

    shape.closePath();

    return new THREE.ShapeGeometry(shape);
  }

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
