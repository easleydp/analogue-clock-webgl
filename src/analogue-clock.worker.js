import * as THREE from "three";
import { MathUtils } from "three";

const clockHandExtrudeSettings = {
  steps: 1,
  depth: 0.0001,
  bevelEnabled: false,
};
class AnalogueClockRenderer {
  constructor() {
    this.options = {};

    this.sceneWidth = 1.1;
    this.sceneHeight = 1.1;
    this.clockRadius = 0.5; // Includes bezel (this.faceRadius will be set once we've created the bezel)

    this.isRunning = false;
    this.scene = null;
    this.camera = null;
    this.renderer = null;

    this.animationFrameId = null;
    this.lastTimestamp = -1; // Last timestamp for animation loop
    this.maxRateHz = 50;
    this.lastRateHz = this.maxRateHz;

    // State variables for second hand physics
    this.lastSystemSecond = -1;
    this.secondHandAnimationPhase = "SETTLED"; // 'SETTLED', 'CREEPING', 'OVERSHOOT', 'RECOIL'
    this.targetSecondBaseAngle = 0; // Normal angle for the current (last ticked) second
    this.secondHandVisualAngle = 0; // Actual rendered angle of the second hand

    this.logoEventTarget = new EventTarget();
  }

  async init(canvas, options, initialWidth, initialHeight, pixelRatio) {
    this.pixelRatio = pixelRatio;
    // TODO: review these options (are they all actually used?)
    this.options = {
      textColor: "#080808",
      markerColor: "#202020",
      fontFamily: '"Work Sans", "Trebuchet MS", sans-serif',
      faceColor: "#FFFFFF",
      secondHandColor: "#BB0000",
      minuteHandColor: "#101010",
      hourHandColor: "#101010",
      romanNumerals: false,
      brand: null, // e.g. "Acme". Displayed as static text on the clock face, half way between the centre pin and the '12'.
      secondHandPhysics: {
        creepDurationMs: 150,
        creepAngleDegrees: 2,
        overshootDegrees: 2,
        recoilDegrees: -1.5,
      },
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
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // Eschew PCFSoftShadowMap; control blur using `radius`
    // renderer size set in onResize

    await this._loadFont();
    await this._createGoldMaterial();
    this._createBezel();
    this._createFace(); // depends on _createBezel() having been called to initialise this.faceRadius
    this._createPin(); // depends on _createBezel() having been called to initialise this.movingPartsMaxHeight
    this._createHands(); // depends on _createPin() having been called to initialise this.pinRadius

    this._createLighting(this.scene);

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
    const fontUrl = new URL(
      "../fonts/WorkSans/WorkSans-Light.ttf",
      import.meta.url
    ).href;
    const fontFace = new FontFace("Work Sans", `url(${fontUrl})`);
    await fontFace.load();
    self.fonts.add(fontFace);
  }

  /**
   * Loads textures for cylinder.
   * @returns Promise that resolves to a map of textures keyed by texture name.
   *
   * Note: Can't use the convenient `THREE.TextureLoader` in a web worker so we
   * have to load the texture image resource files ourselves, convert them to
   * image bitmaps, then pass each to the `THREE.Texture` constructor.
   */
  async _loadGoldTextures(goldType) {
    let folder, fileStem, fileTails;
    if (goldType === "damascus") {
      folder = "Metal_Damascus_Steel_001_SD";
      fileStem = "Metal_Damascus_Steel_001_";
      fileTails = {
        texture2AO: "ambientOcclusion.jpg",
        textureMetal: "metallic.jpg",
        textureRough: "roughness.jpg",
        textureNormal: "normal.jpg",
        textureHeight: "height.png",
        textureColor: "basecolor.jpg",
      };
    } else if (goldType === "gold_1") {
      folder = "gold_1";
      fileStem = "gold_1_";
      fileTails = {
        texture2AO: "ambientOcclusion.jpeg",
        textureMetal: "metallic.jpeg",
        textureRough: "roughness.jpeg",
        textureNormal: "normal.jpeg",
        textureHeight: "height.jpeg",
        textureColor: "baseColor.jpeg",
      };
    } else {
      throw new Error(`Unrecognised goldType: ${goldType}`);
    }

    const promises = Object.entries(fileTails).map(async ([key, fileTail]) => {
      return new Promise((resolve, reject) => {
        if (!fileTail) {
          resolve([key, null]);
          return;
        }
        const path = new URL(
          // NOTE: The `url` string parameter passed to the `URL` ctor must be static so
          // it can be analysed by Vite. This means we can't use a variable!
          `../textures/${folder}/${fileStem}${fileTail}`,
          import.meta.url
        ).href;
        console.log({
          url: `../textures/${folder}/${fileStem}${fileTail}`,
          path,
        });

        fetch(path)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.blob();
          })
          .then((blob) => createImageBitmap(blob))
          .then((imageBitmap) => {
            const texture = new THREE.Texture(imageBitmap);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(2, 2);
            texture.needsUpdate = true;
            // ImageBitmaps are decoded with the origin at the top-left, which is what WebGL expects.
            // Three.js's TextureLoader flips UVs for historical reasons with HTMLImageElement.
            // We set flipY to false to prevent this inversion when using ImageBitmap.
            texture.flipY = false;
            resolve([key, texture]);
          })
          .catch((err) => {
            reject(new Error(`Failed to load texture ${path}: ${err.message}`));
          });
      });
    });

    return new Promise((resolve, reject) => {
      Promise.all(promises).then((results) => {
        resolve(
          results.reduce((accum, [key, texture]) => {
            accum[key] = texture;
            return accum;
          }, {})
        );
      });
    });
  }

  _createLighting(scene) {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 5);
    directionalLight.position.set(5, 4, 10); // Positioned to cast a clear shadow
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.left = -this.clockRadius * 1.2;
    directionalLight.shadow.camera.right = this.clockRadius * 1.2;
    directionalLight.shadow.camera.top = this.clockRadius * 1.2;
    directionalLight.shadow.camera.bottom = -this.clockRadius * 1.2;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 20;
    directionalLight.shadow.bias = -0.0005;
    directionalLight.shadow.radius = 4.5;

    scene.add(directionalLight);
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

  async _createGoldMaterial() {
    // TODO: why are we having to set `side`` to BackSide (or Double)?
    const simple = true;
    if (simple) {
      // Simple gold material
      this.goldMaterial = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 0.8,
        roughness: 0.2,
        side: THREE.BackSide,
      });
    } else {
      // PBR gold material
      const goldType = "gold_2";
      const textures = await this._loadGoldTextures(goldType);
      if (goldType === "damascus") {
        this.goldMaterial = new THREE.MeshStandardMaterial({
          map: textures.textureColor,
          normalMap: textures.textureNormal,
          // How much the normal map affects the material. Typical ranges are 0-1. Default is a Vector2 set to (1,1).
          normalScale: new THREE.Vector2(1, 1),
          displacementMap: textures.textureHeight,
          displacementScale: 0.0, // How much the displacement map affects the mesh
          displacementBias: 0, // Added to the scaled sample of the displacement map
          roughnessMap: textures.textureRough,
          roughness: 0.0, // 0.0 means perfectly shiny, 1.0 means fully matt
          aoMap: textures.texture2AO,
          aoMapIntensity: 1, // Intensity of the ambient occlusion effect. Range is 0-1, where 0 disables ambient occlusion
          metalnessMap: textures.textureMetal,
          // Non-metallic materials such as wood or stone use 0.0, metallic use 1.0.
          // If metalnessMap is also provided, both values are multiplied.
          // When the product is 1.0 there is no diffuse color (the color comes from reflections).
          metalness: 0.5,
          color: 0xffd700, // Base color, texture will dominate
          side: THREE.BackSide,
          //wireframe: true,
        });
      } else {
        this.goldMaterial = new THREE.MeshStandardMaterial({
          map: textures.textureColor,
          normalMap: textures.textureNormal,
          // How much the normal map affects the material. Typical ranges are 0-1. Default is a Vector2 set to (1,1).
          normalScale: new THREE.Vector2(1, 1),
          displacementMap: textures.textureHeight,
          displacementScale: 0.0, // How much the displacement map affects the mesh
          displacementBias: 0, // Added to the scaled sample of the displacement map
          roughnessMap: textures.textureRough,
          roughness: 0.5, // 0.0 means perfectly shiny, 1.0 means fully matt
          aoMap: textures.texture2AO,
          aoMapIntensity: 1, // Intensity of the ambient occlusion effect. Range is 0-1, where 0 disables ambient occlusion
          metalnessMap: textures.textureMetal,
          // Non-metallic materials such as wood or stone use 0.0, metallic use 1.0.
          // If metalnessMap is also provided, both values are multiplied.
          // When the product is 1.0 there is no diffuse color (the color comes from reflections).
          metalness: 0.8,
          color: 0xffd700, // Base color, texture will dominate
          side: THREE.BackSide,
          //wireframe: true,
        });
      }
    }
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
    const chord = new THREE.Vector2().subVectors(endPoint, startPoint);
    const chordLength = chord.length();
    const nSegments = intermediatePointCount + 1;

    // Handle straight line cases
    if (chordLength < 1e-6 || Math.abs(sweep) < 1e-6) {
      points.push(startPoint.clone());
      points.push(endPoint.clone());
      return points;
    }

    const absSweep = Math.abs(sweep);
    const radius = chordLength / (2 * Math.sin(absSweep / 2));

    // h is the distance from the chord's midpoint to the circle's center
    const h = Math.sqrt(Math.max(0, radius * radius - (chordLength / 2) ** 2));

    const midpoint = new THREE.Vector2()
      .addVectors(startPoint, endPoint)
      .multiplyScalar(0.5);

    // A normalized vector perpendicular to the chord.
    // (x, y) -> (-y, x) is a 90-degree counter-clockwise rotation.
    // This vector points to the "left" of the chord from start to end.
    const perp = new THREE.Vector2(-chord.y, chord.x).normalize();

    // The center of the circle is offset from the chord's midpoint along the perpendicular.
    // The direction of the offset depends on the sweep direction.
    // A positive (CCW) sweep means the center is on the "left" side.
    // A negative (CW) sweep means the center is on the "right" side.
    const sweepSign = Math.sign(sweep);
    const center = midpoint
      .clone()
      .add(perp.clone().multiplyScalar(h * sweepSign));

    // Vector from the new center to the start point.
    const vec_C_to_S = new THREE.Vector2().subVectors(startPoint, center);

    const angleIncrement = sweep / nSegments;

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
    const pinRadius = (this.pinRadius = this.clockRadius / 30);
    const pinH = this.movingPartsMaxHeight * 0.8;
    const pinHoleRadius = pinRadius / 6;
    const points = [];

    // Pin starts near the middle of the clock, just after the pin hole.
    points.push(new THREE.Vector2(pinHoleRadius, pinH));
    // Pin's outer edge is small curved bevel
    points.push(
      ...this._generateCurvePoints(
        new THREE.Vector2(pinRadius / 3, pinH),
        new THREE.Vector2(pinRadius, 0),
        -Math.PI / 2,
        4
      )
    );
    // console.log(
    //   "pin points",
    //   JSON.stringify(
    //     points.map((v) => {
    //       return { x: v.x, y: v.y };
    //     })
    //   )
    // );

    const geometry = new THREE.LatheGeometry(points, 48);
    const pin = new THREE.Mesh(geometry, this.goldMaterial);
    pin.castShadow = true;

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
    this.movingPartsMaxHeight = bezelDiagH;

    const points = [];

    // Bezel starts with a diagonal up from y=0 and terminates with a curve down to y=0
    points.push(new THREE.Vector2(this.faceRadius, 0));
    points.push(
      ...this._generateCurvePoints(
        new THREE.Vector2(this.faceRadius + bezelDiagW, bezelDiagH),
        new THREE.Vector2(this.clockRadius, 0),
        -Math.PI * 0.67,
        curveSegments
      )
    );
    // console.log(
    //   "bezel points",
    //   JSON.stringify(
    //     points.map((v) => {
    //       return { x: v.x, y: v.y };
    //     })
    //   )
    // );

    const geometry = new THREE.LatheGeometry(points, 96);
    const bezel = new THREE.Mesh(geometry, this.goldMaterial);
    bezel.castShadow = true;

    // The lathe creates geometry along the Y axis. Rotate so it points toward the camera.
    bezel.rotation.x = Math.PI / 2;

    this.scene.add(bezel);
  }

  async _createFace() {
    if (!this.faceRadius) throw new Error("this.faceRadius not initialised");
    const radius = this.faceRadius;
    const faceGroup = new THREE.Group();
    this.scene.add(faceGroup);

    // Create the clock face
    const faceGeometry = new THREE.CircleGeometry(radius, 64);
    // Note: MeshBasicMaterial, being an 'unlit material', doesn't support receiving a shadow
    const faceMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.options.faceColor),
      metalness: 0.0,
      roughness: 0.9, // A slightly soft, matte look
      side: THREE.DoubleSide,
    });
    const face = new THREE.Mesh(faceGeometry, faceMaterial);
    face.receiveShadow = true;
    faceGroup.add(face);

    // Create markers
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: this.options.markerColor,
    });
    const markersGroup = new THREE.Group();
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
    faceGroup.add(numeralsGroup);
    const numeralsRadius = markersRadius * 0.82;

    for (let h = 1; h <= 12; h++) {
      const angle = -(h / 12) * Math.PI * 2 + Math.PI / 2;
      const numeral = this._createTextSprite(h.toString(), {
        fontFamily: this.options.fontFamily,
        color: this.options.textColor,
        fontSize: 240,
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

    // Create logo
    if (this.options.logo) {
      // Wait for the logo data to be received from the main thread
      await new Promise((resolve) => {
        if (this.logoData) {
          resolve(); // Data has already been received
        } else {
          this.logoEventTarget.addEventListener(
            "logoDataReceived",
            () => resolve(),
            {
              once: true,
            }
          );
        }
      });

      // logoData is array of arrays (shapes with shape points)
      const shapes = this.logoData.map((points) => {
        const vPoints = points.map((p) => new THREE.Vector2(p.x, p.y));
        return new THREE.Shape(vPoints);
      });

      const geometry = new THREE.ShapeGeometry(shapes);
      geometry.center();
      const material = new THREE.MeshBasicMaterial({
        color: this.options.logo.colour,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      const scaleFactor = this.options.logo.scaleFactor * radius;
      mesh.scale.set(scaleFactor, scaleFactor, 1);
      mesh.position.y = radius * 0.42;
      mesh.rotation.z = Math.PI;
      mesh.rotation.y = Math.PI;
      faceGroup.add(mesh);
    }
  }

  _logoDataReceived(logoData) {
    this.logoData = logoData;
    this.logoEventTarget.dispatchEvent(new Event("logoDataReceived"));
  }

  _createHands() {
    const minuteAndHourMaterial = new THREE.MeshStandardMaterial({
      color: this.options.minuteHandColor,
      metalness: 0.8,
      roughness: 0.2,
    });

    const hourHandLen = this.faceRadius * 0.5;
    const hourHandGeom = this._createHourOrMinuteHandGeom(
      hourHandLen,
      hourHandLen / 29,
      hourHandLen / 9
    );

    this.hourHand = new THREE.Mesh(hourHandGeom, minuteAndHourMaterial);
    this.hourHand.castShadow = true;
    // The lowest moving part but still high enough make its shadow discernable
    this.hourHand.position.setZ(this.movingPartsMaxHeight * 0.4);
    this.scene.add(this.hourHand);

    const minuteHandLen = this.faceRadius * 0.7;
    const minuteHandGeom = this._createHourOrMinuteHandGeom(
      minuteHandLen,
      minuteHandLen / 29,
      minuteHandLen / 15
    );

    this.minuteHand = new THREE.Mesh(minuteHandGeom, minuteAndHourMaterial);
    this.minuteHand.castShadow = true;
    this.minuteHand.position.setZ(this.movingPartsMaxHeight * 0.55);
    this.scene.add(this.minuteHand);

    const secondHandMaterial = new THREE.MeshStandardMaterial({
      color: this.options.secondHandColor,
      metalness: 0.0,
      roughness: 1.0,
    });
    const secondHandLen = this.faceRadius * 0.83;
    const secondHandTailLen = this.faceRadius * 0.15;
    const secondHandWidth = this.faceRadius * 0.01;
    const secondHandGeom = this._createSecondHandGeom(
      secondHandLen,
      secondHandTailLen,
      secondHandWidth
    );
    this.secondHand = new THREE.Mesh(secondHandGeom, secondHandMaterial);
    this.secondHand.castShadow = true;
    this.secondHand.position.setZ(this.movingPartsMaxHeight * 0.9);
    this.scene.add(this.secondHand);
  }

  /**
   * Helper method for creating a THREE.ShapeGeometry for the second hand.
   *
   * The shape is a long, thin rectangle with rounded ends and a circular
   * element at the pivot point. It is symmetrical about the y-axis and points
   * upwards, with its pivot at the origin [0, 0].
   *
   * @returns {THREE.ExtrudeGeometry} A clock hand geometry (extruded so it can cast a shadow).
   */
  _createSecondHandGeom(length, tailLength, width) {
    const shape = new THREE.Shape();

    const halfWidth = width / 2;
    const centerRadius = this.pinRadius * 0.5;

    // Calculate the Y-coordinate where the straight sides of the hand
    // meet the central circle tangentially.
    const tangentY = Math.sqrt(centerRadius ** 2 - halfWidth ** 2);

    // Start at the top-right of the hand's main body
    shape.moveTo(halfWidth, length - halfWidth);

    // Top semi-circular arc
    shape.absarc(0, length - halfWidth, halfWidth, 0, Math.PI, false);

    // Left vertical line (from top arc to central circle)
    shape.lineTo(-halfWidth, tangentY);

    // Arc around the left side of the central circle
    const startAngleLeft = Math.atan2(tangentY, -halfWidth);
    const endAngleLeft = Math.atan2(-tangentY, -halfWidth);
    shape.absarc(0, 0, centerRadius, startAngleLeft, endAngleLeft, false);

    // Left vertical line (from central circle to tail arc)
    shape.lineTo(-halfWidth, -(tailLength - halfWidth));

    // Bottom semi-circular arc (tail)
    shape.absarc(0, -(tailLength - halfWidth), halfWidth, Math.PI, 0, false);

    // Right vertical line (from tail arc to central circle)
    shape.lineTo(halfWidth, -tangentY);

    // Arc around the right side of the central circle
    const startAngleRight = Math.atan2(-tangentY, halfWidth);
    const endAngleRight = Math.atan2(tangentY, halfWidth);
    shape.absarc(0, 0, centerRadius, startAngleRight, endAngleRight, false);

    // Right vertical line (from central circle to top arc)
    shape.lineTo(halfWidth, length - halfWidth);

    shape.closePath();

    return new THREE.ExtrudeGeometry(shape, clockHandExtrudeSettings);
  }

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
   * @returns {THREE.ExtrudeGeometry} A clock hand geometry (extruded so it can cast a shadow).
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

    return new THREE.ExtrudeGeometry(shape, clockHandExtrudeSettings);
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

      const now = new Date();
      const currentSeconds = now.getSeconds();
      const currentMilliseconds = now.getMilliseconds();

      // --- SECOND HAND PHYSICS LOGIC ---
      const newSecondDetected = currentSeconds !== this.lastSystemSecond;

      if (newSecondDetected) {
        this.lastSystemSecond = currentSeconds;
        this.targetSecondBaseAngle = (currentSeconds / 60) * 360; // Normal angle for the new second
        this.secondHandAnimationPhase = "OVERSHOOT";
        this.secondHandVisualAngle =
          this.targetSecondBaseAngle +
          this.options.secondHandPhysics.overshootDegrees;
      } else {
        switch (this.secondHandAnimationPhase) {
          case "OVERSHOOT":
            this.secondHandAnimationPhase = "RECOIL";
            this.secondHandVisualAngle =
              this.targetSecondBaseAngle +
              this.options.secondHandPhysics.recoilDegrees;
            break;
          case "RECOIL":
            this.secondHandAnimationPhase = "SETTLED";
            this.secondHandVisualAngle = this.targetSecondBaseAngle;
            break;
          case "SETTLED":
            const millisecondsUntilNextTick = 1000 - currentMilliseconds;
            if (
              millisecondsUntilNextTick <=
                this.options.secondHandPhysics.creepDurationMs &&
              millisecondsUntilNextTick > 0
            ) {
              this.secondHandAnimationPhase = "CREEPING";
              // Fall through to CREEPING case to calculate position immediately
            } else {
              this.secondHandVisualAngle = this.targetSecondBaseAngle; // Stay settled
              break; // Important: Break if not transitioning to CREEPING
            }
          // falls through to CREEPING if phase just changed or was already CREEPING
          case "CREEPING":
            // Ensure we are still in the creep window
            let msUntilNextTick = 1000 - currentMilliseconds;
            if (
              msUntilNextTick >
                this.options.secondHandPhysics.creepDurationMs ||
              msUntilNextTick < 0
            ) {
              // Creep window passed or time jumped, revert to settled or await next tick
              this.secondHandAnimationPhase = "SETTLED";
              this.secondHandVisualAngle = this.targetSecondBaseAngle;
            } else {
              const timeIntoCreepMs =
                this.options.secondHandPhysics.creepDurationMs -
                msUntilNextTick;
              let creepProgress =
                timeIntoCreepMs /
                this.options.secondHandPhysics.creepDurationMs;
              creepProgress = Math.max(0, Math.min(1, creepProgress)); // Clamp progress

              const additionalCreepAngle =
                creepProgress *
                this.options.secondHandPhysics.creepAngleDegrees;
              this.secondHandVisualAngle =
                this.targetSecondBaseAngle + additionalCreepAngle;
            }
            break;
          default: // Shouldn't happen
            console.error("Illegal condition", this.secondHandAnimationPhase);
            this.secondHandAnimationPhase = "SETTLED";
            this.targetSecondBaseAngle = (currentSeconds / 60) * 360;
            this.secondHandVisualAngle = this.targetSecondBaseAngle;
            break;
        }
      }
      const clockDegToRad = (d) => {
        return -MathUtils.degToRad(d);
      };

      this.secondHand.rotation.z = clockDegToRad(this.secondHandVisualAngle);
      if (newSecondDetected) {
        const currentMinutes = now.getMinutes() + currentSeconds / 60;
        const minuteAngle = (currentMinutes / 60) * 360;
        this.minuteHand.rotation.z = clockDegToRad(minuteAngle);

        const currentHours = (now.getHours() % 12) + currentMinutes / 60;
        const hourAngle = (currentHours / 12) * 360;
        this.hourHand.rotation.z = clockDegToRad(hourAngle);
      }

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
    case "logo":
      renderer._logoDataReceived(payload);
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
